import { copyFileSync, constants, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A tab opened before deployment can request an old lazy chunk afterwards.
// Preserve immutable assets only; index.html always comes from the new build.
export function preserveClientAssets(previousDist, nextDist) {
  const previous = join(resolve(previousDist), 'assets');
  const next = join(resolve(nextDist), 'assets');
  if (previous === next) throw new Error('Client builds must be distinct');
  for (const directory of [previous, next]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Client assets must be a real directory');
  }
  let copied = 0;
  for (const name of readdirSync(previous)) {
    const source = join(previous, name), target = join(next, name);
    if (!lstatSync(source).isFile()) throw new Error(`Client asset must be a regular file: ${name}`);
    if (existsSync(target)) {
      if (!lstatSync(target).isFile() || !readFileSync(source).equals(readFileSync(target))) {
        throw new Error(`Client asset collision: ${name}`);
      }
    } else {
      copyFileSync(source, target, constants.COPYFILE_EXCL);
      copied += 1;
    }
  }
  return copied;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: preserve-client-assets.mjs <previous dist> <next dist>');
  console.log(`Preserved ${preserveClientAssets(process.argv[2], process.argv[3])} previous client assets`);
}
