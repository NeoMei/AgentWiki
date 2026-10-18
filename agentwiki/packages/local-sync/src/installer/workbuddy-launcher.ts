/** Runs inside the selected Node at every MCP start; npm retains control of stdio, signals and its locks. */
export const WORKBUDDY_NPX_LAUNCHER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const [npmCli, cacheFlag, cache] = process.argv.slice(1);
try {
  if (cacheFlag !== '--cache' || !path.isAbsolute(cache)
    || path.dirname(cache) !== fs.realpathSync(os.tmpdir())
    || !/^agentwiki-workbuddy-npm-[A-Za-z0-9]{6}$/.test(path.basename(cache))) {
    throw new Error('unexpected cache path');
  }
  try { fs.mkdirSync(cache, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = fs.lstatSync(cache);
  if (!info.isDirectory() || info.isSymbolicLink()
    || (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
    throw new Error('cache must be a private directory owned by this user');
  }
} catch (error) {
  console.error('WorkBuddy npm cache rejected: ' + error.message);
  process.exit(1);
}
// node -e has already set argv[1] to npmCli. npm/npx can rewrite the remaining arguments normally.
require(npmCli);
`.trim();
