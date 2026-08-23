const DEVICE_AUTH_PATH = '/onboard/device';
const OBSIDIAN_GUIDE_PATH = '/guide/obsidian';
const DEVICE_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const ENCODED_CONTROL_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

const containsControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
};

/**
 * Accept only the exact public routes that need to survive an authentication
 * round-trip. Keeping this deliberately narrow avoids turning the landing
 * page's returnTo parameter into an open redirect.
 */
export const safeReturnTo = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || ENCODED_CONTROL_PATTERN.test(value) || containsControlCharacter(value)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, 'https://agentwiki.invalid');
  } catch {
    return null;
  }

  if (parsed.origin !== 'https://agentwiki.invalid' || parsed.hash) {
    return null;
  }

  if (parsed.pathname === OBSIDIAN_GUIDE_PATH) {
    return parsed.search ? null : OBSIDIAN_GUIDE_PATH;
  }
  if (parsed.pathname !== DEVICE_AUTH_PATH) return null;

  const keys = [...parsed.searchParams.keys()];
  if (keys.some((key) => key !== 'user_code') || parsed.searchParams.getAll('user_code').length > 1) {
    return null;
  }
  const userCode = parsed.searchParams.get('user_code');
  if (userCode !== null && !DEVICE_CODE_PATTERN.test(userCode)) return null;

  return `${parsed.pathname}${parsed.search}`;
};
