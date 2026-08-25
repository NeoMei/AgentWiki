// Keep browser-side limits aligned with validator.js `isLength`. Surrogate
// pairs count once, and one variation selector following a non-selector code
// unit is part of the preceding character.
const nextValidatorUnitEnd = (value: string, offset: number) => {
  let end = offset + 1;
  const first = value.charCodeAt(offset);
  if (first >= 0xd800 && first <= 0xdbff && end < value.length) {
    const second = value.charCodeAt(end);
    if (second >= 0xdc00 && second <= 0xdfff) end += 1;
  }
  if (first !== 0xfe0e && first !== 0xfe0f && end < value.length) {
    const next = value.charCodeAt(end);
    if (next === 0xfe0e || next === 0xfe0f) end += 1;
  }
  return end;
};

export const validatorLength = (value: string) => {
  let offset = 0;
  let length = 0;
  while (offset < value.length) {
    offset = nextValidatorUnitEnd(value, offset);
    length += 1;
  }
  return length;
};

export const truncateValidatorLength = (value: string, maxLength: number) => {
  let offset = 0;
  let length = 0;
  while (offset < value.length && length < maxLength) {
    offset = nextValidatorUnitEnd(value, offset);
    length += 1;
  }
  return value.slice(0, offset);
};
