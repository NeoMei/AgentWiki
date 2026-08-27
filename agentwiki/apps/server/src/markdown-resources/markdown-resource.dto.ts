import { Transform, Type } from 'class-transformer';
import { foldCase } from '@neomei/agentwiki-sync-protocol';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const MAX_REFERENCE_LENGTH = 512;
const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });

export function normalizeMarkdownPageIdentity(value: string): string {
  return foldCase(value.normalize('NFC').trim());
}

function normalizeAttachmentReferenceIdentity(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('und');
}

export class MarkdownResourceReferenceDto {
  @PreserveRawInput()
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(MAX_REFERENCE_LENGTH)
  key!: string;

  @PreserveRawInput()
  @IsIn(['page', 'attachment'])
  kind!: 'page' | 'attachment';

  @PreserveRawInput()
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(MAX_REFERENCE_LENGTH)
  target!: string;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(MAX_REFERENCE_LENGTH)
  heading?: string;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @Matches(/^[\p{L}\p{N}_-]+$/u)
  @MaxLength(MAX_REFERENCE_LENGTH)
  blockId?: string;
}

@ValidatorConstraint({ name: 'uniqueMarkdownResourceReferences', async: false })
class UniqueMarkdownResourceReferences implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return true;
    const keys = new Set<string>();
    const references = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const reference = item as Partial<MarkdownResourceReferenceDto>;
      if (reference.heading !== undefined && reference.blockId !== undefined) return false;
      if (
        reference.kind === 'attachment'
        && (reference.heading !== undefined || reference.blockId !== undefined)
      ) return false;
      if (
        typeof reference.key !== 'string'
        || typeof reference.kind !== 'string'
        || typeof reference.target !== 'string'
      ) continue;
      const key = normalizeMarkdownPageIdentity(reference.key);
      const signature = [
        reference.kind,
        reference.kind === 'attachment'
          ? normalizeAttachmentReferenceIdentity(reference.target)
          : normalizeMarkdownPageIdentity(reference.target),
        typeof reference.heading === 'string' ? normalizeMarkdownPageIdentity(reference.heading) : '',
        typeof reference.blockId === 'string' ? normalizeMarkdownPageIdentity(reference.blockId) : '',
      ].join('\u0000');
      if (keys.has(key) || references.has(signature)) return false;
      keys.add(key);
      references.add(signature);
    }
    return true;
  }

  defaultMessage(): string {
    return 'references must have unique normalized keys and resource identities, with at most one fragment';
  }
}

export class ResolveMarkdownResourcesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MarkdownResourceReferenceDto)
  @Validate(UniqueMarkdownResourceReferences)
  references!: MarkdownResourceReferenceDto[];
}

export type ResolvedMarkdownResource =
  | { key: string; status: 'resolved'; kind: 'page'; pageId: string; title: string; slug: string }
  | { key: string; status: 'resolved'; kind: 'attachment'; attachmentId: string; displayName: string; mimeType: string; width: number; height: number }
  | { key: string; status: 'unresolved' }
  | { key: string; status: 'ambiguous' };
