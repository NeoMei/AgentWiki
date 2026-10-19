import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type BrowserRunner = (command: string, args: string[]) => Promise<unknown>;

/** Hand the URL to the OS without a shell; failure leaves manual authorization usable. */
export async function openAuthorizationBrowser(
  value: string,
  platform: NodeJS.Platform = process.platform,
  run: BrowserRunner = (command, args) => execute(command, args, { timeout: 5000, windowsHide: true }),
): Promise<boolean> {
  try {
    const url = new URL(value);
    if (url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return false;
    if (platform === 'darwin') await run('open', [url.href]);
    else if (platform === 'win32') await run('rundll32.exe', ['url.dll,FileProtocolHandler', url.href]);
    else if (platform === 'linux') await run('xdg-open', [url.href]);
    else return false;
    return true;
  } catch {
    return false;
  }
}
