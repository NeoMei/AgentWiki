import { isIP } from 'node:net';

export function assertLoopbackDatabaseHost(parsed, variableName) {
  const hostname = parsed.hostname.toLowerCase();
  const isIpv4Loopback = isIP(hostname) === 4 && hostname.startsWith('127.');
  if (hostname === 'localhost' || hostname === '[::1]' || isIpv4Loopback) return;

  throw new Error(`${variableName} host must be loopback`);
}
