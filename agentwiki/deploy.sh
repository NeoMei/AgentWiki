#!/usr/bin/env bash
set -euo pipefail

SUPPORTED_NODE_MAJORS="24 26"

require_supported_node() {
  local executable="${1:-node}"
  local version major
  version="$("${executable}" --version 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  case " ${SUPPORTED_NODE_MAJORS} " in
    *" ${major} "*) return 0 ;;
    *)
      echo "AgentWiki requires Node.js 24 or 26; ${executable} reports ${version:-not installed}." >&2
      return 1
      ;;
  esac
}

require_supported_node node

REMOTE_HOST="${1:-100.64.35.78}"
REMOTE_USER="${2:-neomei}"
PROJECT_DIR="agentwiki"
ARCHIVE="agentwiki-release-$(date +%Y%m%d%H%M%S).tar.gz"

cleanup() {
  rm -f "${ARCHIVE}"
}
trap cleanup EXIT


SSH_TOOL=(ssh)
SCP_TOOL=(scp)
if command -v sshpass >/dev/null 2>&1 && [ -n "${SSHPASS:-}" ]; then
  SSH_TOOL=(sshpass -e ssh)
  SCP_TOOL=(sshpass -e scp)
fi

echo "Packaging AgentWiki direct-runtime release..."
COPYFILE_DISABLE=1 tar \
  --exclude='.env' \
  --exclude='apps/server/.env' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='coverage' \
  --exclude='*.tar.gz' \
  -czf "${ARCHIVE}" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .dockerignore \
  apps packages scripts deploy deploy.sh

"${SCP_TOOL[@]}" "${ARCHIVE}" "${REMOTE_USER}@${REMOTE_HOST}:~/"

"${SSH_TOOL[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "bash -se" <<REMOTE
set -euo pipefail
supported_node_majors="24 26"
node_binary="/usr/bin/node"
node_version="\$("\$node_binary" --version 2>/dev/null || true)"
node_major="\${node_version#v}"
node_major="\${node_major%%.*}"
case " \$supported_node_majors " in
  *" \$node_major "*) ;;
  *)
    echo "AgentWiki requires Node.js 24 or 26; \$node_binary reports \${node_version:-not installed}." >&2
    exit 1
    ;;
esac
live_dir="\$HOME/${PROJECT_DIR}"
exec 9>"\$HOME/.agentwiki-deploy.lock"
if ! flock -n 9; then
  echo "Another AgentWiki deployment is already running." >&2
  exit 1
fi
if [ ! -f "\$live_dir/.env" ]; then
  echo "Existing production .env is required; deployment will not generate secrets." >&2
  exit 1
fi
release_dir="\$(mktemp -d "\$HOME/agentwiki-release.XXXXXX")"
migration_started=0
cleanup_release() {
  if [ -n "\${release_dir:-}" ] && [ -d "\$release_dir" ]; then
    if [ "\${migration_started:-0}" = 1 ]; then
      echo "Staged release retained after migration attempt at \$release_dir" >&2
    else
      rm -rf -- "\$release_dir"
    fi
  fi
}
trap cleanup_release EXIT
tar -xzf "\$HOME/${ARCHIVE}" -C "\$release_dir"
rm -f "\$HOME/${ARCHIVE}"
install -m 0600 "\$live_dir/.env" "\$release_dir/.env"
mkdir -p "\$release_dir/apps/server"
if [ -f "\$live_dir/apps/server/.env" ]; then
  install -m 0600 "\$live_dir/apps/server/.env" "\$release_dir/apps/server/.env"
else
  touch "\$release_dir/apps/server/.env"
  chmod 600 "\$release_dir/apps/server/.env"
fi
cd "\$release_dir"

set_env_value() {
  local file="\$1" key="\$2" value="\$3"
  if grep -q "^\${key}=" "\$file"; then
    sed -i "s|^\${key}=.*|\${key}=\${value}|" "\$file"
  else
    printf '%s=%s\n' "\$key" "\$value" >> "\$file"
  fi
}

local_sync_version="\$("\$node_binary" -p "require('./packages/local-sync/package.json').version")"
case "\$local_sync_version" in
  ''|*[!0-9A-Za-z.-]*)
    echo "Invalid local-sync package version in packages/local-sync/package.json." >&2
    exit 1
    ;;
esac
set_env_value .env LOCAL_SYNC_PACKAGE_VERSION "\$local_sync_version"
set_env_value apps/server/.env LOCAL_SYNC_PACKAGE_VERSION "\$local_sync_version"

ensure_base64_secret() {
  local key="\$1" value
  if grep -q "^\${key}=" .env; then
    return
  fi
  value="\$(openssl rand -base64 32 | tr -d '\n')"
  "\$node_binary" -e 'if (Buffer.from(process.argv[1], "base64").length !== 32) process.exit(1)' "\$value"
  set_env_value .env "\$key" "\$value"
}

ensure_base64_secret AGENTWIKI_SERVER_PEPPER
ensure_base64_secret AGENTWIKI_DEPLOYMENT_SEED

if ! grep -q '^JWT_SECRET=' .env; then
  secret="\$(sed -n 's/^APP_SECRET=//p' .env | head -n1)"
  test -n "\$secret"
  printf 'JWT_SECRET=%s\n' "\$secret" >> .env
fi
if ! grep -q '^CORS_ORIGINS=' .env; then
  origin="\$(sed -n 's/^CLIENT_URL=//p' .env | head -n1)"
  test -n "\$origin"
  printf 'CORS_ORIGINS=%s\n' "\$origin" >> .env
fi
grep -q '^MCP_ALLOWED_HOSTS=' .env || printf 'MCP_ALLOWED_HOSTS=${REMOTE_HOST},localhost,127.0.0.1\n' >> .env
grep -q '^ALLOWED_GIT_HOSTS=' .env || printf 'ALLOWED_GIT_HOSTS=github.com,gitlab.com\n' >> .env
sed -i '/^NODE_IMAGE=/d;/^NGINX_IMAGE=/d' .env

public_api_url="\$(sed -n 's/^PUBLIC_API_URL=//p' apps/server/.env | tail -n1)"
if [ -z "\$public_api_url" ]; then
  public_api_url="\$(sed -n 's/^PUBLIC_API_URL=//p' .env | tail -n1)"
fi
case "\$public_api_url" in
  https://*/api|https://*/api/) ;;
  *)
    echo "PUBLIC_API_URL must be the externally reachable HTTPS /api URL before deployment." >&2
    exit 1
    ;;
esac

chmod 600 .env apps/server/.env

# Build and verify the staged release before stopping production.
pnpm install --frozen-lockfile
pnpm --filter @agentwiki/server exec prisma generate --schema=prisma/schema.prisma
pnpm --filter @agentwiki/shared build
pnpm --filter @neomei/agentwiki-sync-protocol build
pnpm --filter @agentwiki/server build
pnpm --filter @agentwiki/client build

mkdir -p "\$HOME/.config/systemd/user"
install -m 0644 deploy/systemd/*.service "\$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
systemctl --user stop agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service

agentwiki_node_processes() {
  local pid cwd
  for pid in \$(pgrep -u "\$USER" node || true); do
    cwd="\$(readlink "/proc/\$pid/cwd" 2>/dev/null || true)"
    case "\$cwd" in
      "\$live_dir"|"\$live_dir"/*) printf '%s\n' "\$pid" ;;
    esac
  done
}

legacy_pids="\$(agentwiki_node_processes)"
if [ -n "\$legacy_pids" ]; then
  while IFS= read -r pid; do
    kill "\$pid" 2>/dev/null || true
  done <<< "\$legacy_pids"
fi

# A TERM is asynchronous. Do not let a legacy process keep executing code that
# references columns removed by the breaking authorization migration.
for attempt in \$(seq 1 20); do
  legacy_pids="\$(agentwiki_node_processes)"
  [ -z "\$legacy_pids" ] && break
  sleep 0.25
done
if [ -n "\${legacy_pids:-}" ]; then
  echo "Old AgentWiki node processes did not stop; refusing schema migration." >&2
  exit 1
fi

if systemctl --user is-active --quiet agentwiki-api.service || \
   systemctl --user is-active --quiet agentwiki-worker.service; then
  echo "Old AgentWiki API or Worker did not stop; refusing schema migration." >&2
  exit 1
fi

migration_started=1
pnpm --filter @agentwiki/server exec prisma migrate deploy

previous_dir="\$HOME/agentwiki-previous-\$(date +%Y%m%d%H%M%S)"
if ! mv -- "\$live_dir" "\$previous_dir"; then
  echo "Failed to preserve the current release; staged release remains at \$release_dir." >&2
  exit 1
fi
if ! mv -- "\$release_dir" "\$live_dir"; then
  echo "Failed to activate staged release; attempting to restore the live path while services remain stopped." >&2
  if ! mv -- "\$previous_dir" "\$live_dir"; then
    echo "Live path restoration also failed; releases remain at \$previous_dir and \$release_dir." >&2
  fi
  exit 1
fi
release_dir=""
chown -R -- "\$(id -u):\$(id -g)" "\$HOME/${PROJECT_DIR}/"
cd "\$live_dir"

systemctl --user restart agentwiki-api.service
systemctl --user restart agentwiki-worker.service
systemctl --user restart agentwiki-frontend.service

for attempt in \$(seq 1 30); do
  api="\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true)"
  ui="\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ || true)"
  if [ "\$api" = 200 ] && [ "\$ui" = 200 ]; then break; fi
  sleep 2
done
test "\${api:-}" = 200
test "\${ui:-}" = 200
systemctl --user --no-pager --full status agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
echo "Previous application tree retained at \$previous_dir; do not reactivate it without restoring its matching database backup."
REMOTE

echo "Direct deployment complete: http://${REMOTE_HOST}:5173"
