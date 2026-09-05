import { FlatAttachmentPathSchema } from '@neomei/agentwiki-sync-protocol';

export function formatAttachmentReference(canonicalPath: string | null): string {
  const parsed = FlatAttachmentPathSchema.safeParse(canonicalPath);
  if (!parsed.success) throw new Error('Attachment is not referenceable');
  return `![[${parsed.data}]]`;
}
