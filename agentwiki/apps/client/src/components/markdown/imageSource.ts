/** Keep reading and editing image URLs on the same allowlist. */
export const isExternalHttpsImage = (src: string): boolean => /^https:\/\//i.test(src);

export const isInternalImage = (src: string): boolean => {
  if (!src || src.startsWith('//') || /\\|%5c/i.test(src)) return false;
  return !/^[a-z][a-z\d+.-]*:/i.test(src);
};
