import { lstatSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const dist = resolve(packageRoot, 'dist');

if (dirname(dist) !== packageRoot || basename(dist) !== 'dist') {
  throw new Error('Refusing to clean an unexpected build directory');
}

try {
  const entry = lstatSync(dist);
  if (entry.isSymbolicLink()) throw new Error('Refusing to clean a symlinked build directory');
  if (!entry.isDirectory()) throw new Error('Refusing to clean a non-directory build path');
  if (realpathSync(dist) !== dist) throw new Error('Refusing to clean a redirected build directory');
  rmSync(dist, { recursive: true, force: true });
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') process.exit(0);
  throw error;
}
