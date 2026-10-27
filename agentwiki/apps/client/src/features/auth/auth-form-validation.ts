export interface AuthFieldError { field: 'name' | 'email' | 'password'; messageKey: string }

const error = (field: AuthFieldError['field'], key: string): AuthFieldError => ({ field, messageKey: `auth.${key}` });

function validEmail(email: string): boolean {
  if (!/^[^\s@]+@[^\s@]+$/u.test(email) || email.length > 254) return false;
  const [local, domain] = email.split('@');
  if (local.length > 64) return false;
  // Unquoted dot-atoms retain the format accepted by the email input while
  // also rejecting empty atoms that the server's IsEmail validator rejects.
  if (!local.split('.').every(atom => /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/iu.test(atom))) return false;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  // Match the server's default IsEmail domain rules: real labels, no underscore,
  // edge hyphen, full-width ASCII, numeric TLD, or overlong label.
  return labels.length > 1
    && /^([a-z\u00a1-\u00a8\u00aa-\ud7ff\uf900-\ufdcf\ufdf0-\uffef]{2,}|xn[a-z0-9-]{2,})$/iu.test(tld)
    && labels.every(label => label.length <= 63 && /^[a-z\u00a1-\uffff0-9-]+$/iu.test(label)
      && !/^-|-$|[\uff01-\uff5e]/u.test(label));
}

/** Validate in visual field order so both forms focus and describe only the first invalid input. */
export function authFormError(input: { name?: string; email: string; password: string }): AuthFieldError | null {
  const registering = input.name !== undefined;
  if (input.name !== undefined) {
    if (!input.name.trim()) return error('name', 'nameRequired');
    if (/\s/u.test(input.name)) return error('name', 'nameWhitespace');
  }
  if (!input.email.trim()) return error('email', 'emailRequired');
  if (!validEmail(input.email.trim())) return error('email', 'emailInvalid');
  if (!input.password.trim()) return error('password', 'passwordRequired');
  if (registering) {
    if (/\s/u.test(input.password)) return error('password', 'passwordWhitespace');
    if (input.password.length < 8) return error('password', 'passwordMin');
    if (!/[A-Z]/.test(input.password)) return error('password', 'passwordUppercase');
    if (!/[0-9]/.test(input.password)) return error('password', 'passwordNumber');
  }
  return null;
}
