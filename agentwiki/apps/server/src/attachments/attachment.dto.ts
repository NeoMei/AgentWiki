import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });

export type AttachmentListStatus = 'active' | 'archived' | 'all';

export class AttachmentListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['active', 'archived', 'all']) status: AttachmentListStatus = 'active';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class AttachmentStateDto {
  @PreserveRawInput()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/)
  expectedUpdatedAt!: string;
}

export interface AttachmentSummary {
  id: string;
  spaceId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  width: number;
  height: number;
  status: 'active' | 'archived';
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
