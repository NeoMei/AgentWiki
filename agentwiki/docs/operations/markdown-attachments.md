# Markdown attachments and embeds operations guide

This guide is the production runbook for Markdown image attachments, protected image
rendering, wiki links, and page embeds. Attachment metadata lives in PostgreSQL while
immutable bytes live in one persistent filesystem root. **A database-only or
filesystem-only backup is incomplete and cannot be used as a supported restore.**

## Runtime architecture and limits

- The API and worker use the same `ATTACHMENT_STORAGE_PATH`. Direct-runtime units use
  `/var/lib/agentwiki/attachments`; Docker mounts the single named `attachment-data`
  volume there for both services. Frontend and migration containers never mount it.
- PostgreSQL `SpaceAttachment` rows contain Space scope, the authoritative display
  name, MIME type, dimensions, size, content hash, storage key and lifecycle state.
  The filesystem stores immutable SHA-256-addressed blobs under private directories.
  Equal bytes are deduplicated; a new same-name upload receives a server-authoritative
  suffix such as `photo (2).png`.
- Accepted images are PNG, JPEG (`.jpg`/`.jpeg`), WebP and GIF. Extension, declared
  MIME and detected magic must agree. Defaults are 10 MiB per file, 500 MiB of active
  attachment metadata per Space, 10,000 pixels per dimension and 40,000,000 decoded
  pixels. Nginx uses `client_max_body_size 11m` so one 10 MiB multipart upload fits
  without creating an unlimited body endpoint.
- The storage health gate requires the directory to be writable and at least
  `ATTACHMENT_MIN_FREE_BYTES` (default 1 GiB) free. Content-lock waits default to five
  seconds. Archived metadata is retained 30 days, filesystem orphans receive a
  24-hour grace period, and cleanup polls hourly by default.

Production settings are documented in `.env.example` and `apps/server/.env.example`:

```env
ATTACHMENT_STORAGE_PATH=/var/lib/agentwiki/attachments
ATTACHMENT_MAX_FILE_BYTES=10485760
ATTACHMENT_MAX_SPACE_BYTES=524288000
ATTACHMENT_MAX_DIMENSION=10000
ATTACHMENT_MAX_PIXELS=40000000
ATTACHMENT_MIN_FREE_BYTES=1073741824
ATTACHMENT_RETENTION_DAYS=30
ATTACHMENT_ORPHAN_GRACE_HOURS=24
ATTACHMENT_CONTENT_LOCK_TIMEOUT_MS=5000
ATTACHMENT_CLEANUP_POLL_MS=3600000
```

`/api/health` is healthy only when HTTP succeeds and its JSON contains both
`status: "ok"` and `attachmentStorage: "ok"`. A bare HTTP 200 from another handler is
not attachment-storage evidence.

## Authorization and rendering contracts

| Operation | Owner | Admin | Editor | Viewer | Outsider / Agent |
| --- | --- | --- | --- | --- | --- |
| List and render active attachments | yes | yes | yes | yes | no unless an Agent has the matching readable Space grant |
| Upload, archive or restore | yes | no | yes | no | no |
| Open picker / paste / drop in editor | yes | no | yes | no | no |
| Delete Space | yes | no | no | no | no |

Human read access is checked against the live Space on every list, resolver and Blob
request. Image elements receive a short-lived in-memory `blob:` URL after an
authenticated Axios request; JWTs and API URLs are never put in DOM attributes.
Unmounting or changing the attachment aborts the request and revokes the Blob URL.

The scoped Markdown resolver batches at most 100 references and resolves only pages
and attachments in the requested Space. Page embeds share one render-tree cache and
are limited to depth 3, 20 embeds and 200,000 Unicode code points. Direct and indirect
cycles, missing sections, over-limit content and load failures produce localized
literal fallbacks. Heading/section embeds are supported; block-ID **links** are
supported, but block-ID page embeds and image fragments are intentionally unsupported.
Historical version previews resolve embedded page content from the current page and
display that provenance explicitly.

In the real CodeMirror editor, the picker uploads or inserts the server-returned name.
Clipboard paste and coordinate drop accept only supported image file types, preserve
operation order and insert `![[authoritative-name]]` at the captured selection. These
changes make the page dirty and require an ordinary page save; uploading the blob does
not silently save the Markdown draft.

## Filesystem ownership and hardening

Provision the exact path as the service user; never fall back below `$HOME`, a release
directory or `/tmp`:

```bash
sudo install -d -o agentwiki -g agentwiki -m 0700 /var/lib/agentwiki/attachments
sudo -u agentwiki test ! -L /var/lib/agentwiki/attachments
sudo -u agentwiki test "$(readlink -f /var/lib/agentwiki/attachments)" = /var/lib/agentwiki/attachments
sudo -u agentwiki test "$(stat -c '%a' /var/lib/agentwiki/attachments)" = 700
sudo -u agentwiki test -w /var/lib/agentwiki/attachments
```

The API creates directories as `0700` and files as `0600`, opens paths with
no-follow protections, validates SHA-256 storage keys, and rejects traversal,
symlinks, non-regular files and inode changes during validation/publish. Both systemd
units retain `UMask=0077`. Do not recursively `chown`, copy over, or place the root in
an application release swap.

## Coordinated backup

Enter maintenance and stop **all writers** before either half of the backup. The
commands below assume a production service user named `agentwiki`; adapt identity and
database URL explicitly, never by sourcing an unreviewed shell file. The capture phase
deliberately leaves writers stopped so it can also be used for a pre-restore rollback
snapshot.

Define this manifest function in the controlled maintenance shell. It walks the two
allowed roots only, uses base64 for raw relative pathname bytes, sorts by those bytes,
records every directory and regular file, and rejects symlinks, devices, sockets,
FIFOs and any other entry type. Regular files are opened with `O_NOFOLLOW` where the
platform provides it and are rejected if identity or size changes while hashing.

```bash
manifest_jsonl() {
  node --input-type=commonjs - "$1" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const slash = Buffer.from('/');
const bundle = Buffer.from(process.argv[2]);
const join = (left, right) => Buffer.concat([left, slash, right]);
const rows = [];

function visit(absolute, relative) {
  const before = fs.lstatSync(absolute, { bigint: true });
  const encodedPath = relative.toString('base64');
  if (before.isSymbolicLink()) throw new Error(`symlink rejected: ${encodedPath}`);
  if (before.isDirectory()) {
    rows.push({ type: 'directory', pathBase64: encodedPath });
    const names = fs.readdirSync(absolute, { encoding: 'buffer' }).sort(Buffer.compare);
    for (const name of names) visit(join(absolute, name), join(relative, name));
    return;
  }
  if (!before.isFile()) throw new Error(`non-regular entry rejected: ${encodedPath}`);

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`file identity changed before hashing: ${encodedPath}`);
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new Error(`file changed while hashing: ${encodedPath}`);
    }
    rows.push({
      type: 'file',
      pathBase64: encodedPath,
      size: opened.size.toString(),
      sha256: hash.digest('hex'),
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

for (const relative of [Buffer.from('database.dump'), Buffer.from('attachments')]) {
  visit(join(bundle, relative), relative);
}
rows.sort((left, right) => Buffer.compare(
  Buffer.from(left.pathBase64, 'base64'),
  Buffer.from(right.pathBase64, 'base64'),
));
process.stdout.write(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
NODE
}
```

Capture the paired state while both services remain stopped:

```bash
backup_dir="$(mktemp -d /var/backups/agentwiki/markdown-attachments.XXXXXXXX)"
sudo -u agentwiki systemctl --user stop agentwiki-api.service agentwiki-worker.service
pg_dump --format=custom --file="$backup_dir/database.dump" "$DATABASE_URL"
mkdir -m 0700 "$backup_dir/attachments"
rsync -a --numeric-ids --delete /var/lib/agentwiki/attachments/ "$backup_dir/attachments/"
manifest_jsonl "$backup_dir" > "$backup_dir/MANIFEST.jsonl"
pg_restore --list "$backup_dir/database.dump" > /dev/null
```

Store the manifest with the two snapshots and protect the whole bundle from later
mutation. A usable backup contains the PostgreSQL custom-format dump, the complete
attachment snapshot, and the manifest that binds entry type, losslessly encoded path,
file byte size and SHA-256 digest. If this is a backup-only maintenance window, verify
the bundle first and resume writers explicitly as a separate action:

```bash
manifest_jsonl "$backup_dir" > "$backup_dir/MANIFEST.recheck.jsonl"
cmp "$backup_dir/MANIFEST.jsonl" "$backup_dir/MANIFEST.recheck.jsonl"
sudo -u agentwiki systemctl --user start agentwiki-api.service agentwiki-worker.service
```

Do **not** run that restart block when the capture is the rollback snapshot for an
active restore.

## Coordinated restore and rollback

Restore is one maintenance operation. Never restore files directly into the live root
while services are running.

1. Stop API and worker. Capture a fresh coordinated rollback bundle with the capture
   commands above, but do not execute the backup-only restart block. Keep its database
   dump, attachment tree and manifest together until restore acceptance.
2. Recheck the selected backup before use by writing `MANIFEST.recheck.jsonl` with
   `manifest_jsonl` and comparing it byte-for-byte with `MANIFEST.jsonl`. This rejects
   missing/extra entries, changed entry types, symlinks/non-regular entries, size
   changes and hash mismatches before database mutation.
3. Create a narrow restore bundle outside the live root. Copy the selected dump and
   attachments into its exact two-root layout, then compare the same manifest again:

   ```bash
   restore_bundle="$(mktemp -d /var/lib/agentwiki/attachments-restore.XXXXXXXX)"
   install -m 0600 "$backup_dir/database.dump" "$restore_bundle/database.dump"
   mkdir -m 0700 "$restore_bundle/attachments"
   rsync -a --numeric-ids --delete "$backup_dir/attachments/" "$restore_bundle/attachments/"
   manifest_jsonl "$restore_bundle" > "$restore_bundle/MANIFEST.candidate.jsonl"
   cmp "$backup_dir/MANIFEST.jsonl" "$restore_bundle/MANIFEST.candidate.jsonl"
   pg_restore --list "$restore_bundle/database.dump" > /dev/null
   ```

   Any manifest or dump check failure aborts while writers remain stopped.
4. Restore the dump while services remain stopped, then run Prisma migration status
   against the restored database. Validate the staged storage root's canonical path,
   owner, `0700` mode, file hashes and free-space floor.
5. Preserve the old live attachment root at a timestamped rollback path, then
   atomically rename the verified `restore_bundle/attachments` directory to
   `/var/lib/agentwiki/attachments`. Keep the pre-restore rollback database dump and
   old filesystem root as one pair. Never move a root during ordinary deployment.
6. Before enabling production services, run a one-shot API on a private loopback port
   with the restored database and live attachment path. Require semantic health:

   ```bash
   response="$(curl -fsS http://127.0.0.1:13000/api/health)"
   node -e 'const h=JSON.parse(process.argv[1]);if(h.status!=="ok"||h.attachmentStorage!=="ok")process.exit(1)' "$response"
   ```

7. Stop the one-shot process, start the normal API and worker, repeat semantic health,
   render a known protected image as an authorized viewer, and only then close the
   maintenance window. If any step fails, stop, restore the paired rollback database
   and filesystem root, and re-run all verification. Never mix halves from different
   backup timestamps.

## Capacity, cleanup and incidents

- Alert on `/api/health` failure, free bytes approaching
  `ATTACHMENT_MIN_FREE_BYTES`, Space quota saturation, cleanup failures, persistent
  content-lock timeouts and growth of archived/orphan candidates.
- Archive is reversible during retention; restore revalidates the optimistic
  `updatedAt` value and quota/name constraints. Cleanup deletes eligible metadata only
  after retention and removes an immutable blob only while holding its content lock
  and proving no row references it. Do not manually delete hash paths to free space.
- On low space, stop uploads/writers, confirm which filesystem is mounted, take a
  coordinated backup, increase capacity or raise the mounted volume, then re-run
  semantic health. Lowering `ATTACHMENT_MIN_FREE_BYTES` is not a capacity repair.
- On a suspected path-traversal, symlink, unexpected owner/mode, hash mismatch or
  cross-Space disclosure, stop API and worker, preserve logs plus the paired database
  and filesystem snapshots, revoke affected sessions, and investigate before any
  cleanup. Never follow a suspect link or run recursive ownership/deletion commands.
- For a cleanup backlog, inspect worker logs and database rows first. Resume the worker
  only after API and worker point to the same canonical root. Never flush Redis or
  delete unrelated Space data as part of attachment recovery.

## Verification

Repository contract, dedicated database and browser commands are listed in
[`docs/TESTING_GUIDE.md`](../TESTING_GUIDE.md). Local loopback evidence proves only the
tested checkout and isolated schema; it is not GitHub, npm, release or production
deployment evidence.
