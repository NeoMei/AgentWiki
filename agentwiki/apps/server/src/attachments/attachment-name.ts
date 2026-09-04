export function normalizeAttachmentName(value: string): { displayName: string; nameKey: string } {
  const displayName = value.normalize('NFC').trim();
  return { displayName, nameKey: displayName.toLocaleLowerCase('und') };
}
