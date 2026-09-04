interface E2ETargetOptions {
  configured?: string;
  fallback: string;
  allowRemote?: string;
  confirmRemoteHost?: string;
  label: string;
}

export const isLoopbackHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true;
    const octets = hostname.split('.');
    return octets.length === 4 && octets[0] === '127' && octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255;
    });
  } catch {
    return false;
  }
};

export const resolveE2ETarget = ({
  configured,
  fallback,
  allowRemote,
  confirmRemoteHost,
  label,
}: E2ETargetOptions): string => {
  const target = configured || fallback;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`Invalid ${label}; use an absolute HTTP(S) URL.`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error(`Invalid ${label}; use an absolute HTTP(S) URL without embedded credentials.`);
  }
  if (!isLoopbackHttpUrl(target)) {
    if (allowRemote !== 'true') {
      throw new Error(`Remote ${label} is blocked. Set ALLOW_REMOTE_E2E=true to opt in explicitly.`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`Remote ${label} must use HTTPS.`);
    }
    const confirmedHost = confirmRemoteHost?.trim().toLowerCase();
    if (!confirmedHost) {
      throw new Error(`Remote ${label} requires CONFIRM_REMOTE_E2E_HOST to match the target host.`);
    }
    if (confirmedHost !== parsed.hostname.toLowerCase()) {
      throw new Error(`Remote ${label} does not match the confirmed host.`);
    }
  }
  return target;
};
