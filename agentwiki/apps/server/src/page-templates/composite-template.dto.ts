import { PageTemplateCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });
const DecimalRevision = () => Matches(/^(0|[1-9][0-9]{0,19})$/u);
const IdempotencyKey = () => Matches(/^[A-Za-z0-9._:-]{8,128}$/u);

export class CompositeTemplateListQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @IsIn(['all', 'system', 'space']) scope?: 'all' | 'system' | 'space';
  @IsOptional() @IsIn(['active', 'archived', 'all']) archived?: 'active' | 'archived' | 'all';
  @IsOptional() @IsEnum(PageTemplateCategory) category?: PageTemplateCategory;
  @IsOptional() @IsIn(['single_page', 'page_group']) kind?: 'single_page' | 'page_group';
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean() supportsCollaboration?: boolean;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class CompositeTemplateDetailQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647) version!: number;
}

@ValidatorConstraint({ name: 'runParticipantBindingShapes', async: false })
class RunParticipantBindingShapes implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
      const item = raw as Record<string, unknown>;
      const allowed = item.kind === 'task_default'
        ? ['agentId', 'kind', 'nodeId', 'roleSlotId']
        : item.kind === 'role_override'
          ? ['agentId', 'kind', 'roleSlotId']
          : [];
      return allowed.length > 0 && Object.keys(item).sort().every((key, index) => key === allowed[index]);
    });
  }
}

export class RunParticipantBindingDto {
  @IsIn(['task_default', 'role_override']) kind!: 'task_default' | 'role_override';
  @ValidateIf((value: RunParticipantBindingDto) => value.kind === 'task_default')
  @IsString() @MinLength(1) @MaxLength(128) nodeId?: string;
  @IsString() @MinLength(1) @MaxLength(128) roleSlotId!: string;
  @IsString() @MinLength(1) @MaxLength(128) agentId!: string;
}

export class PreviewCompositeTemplateDto {
  @IsInt() @Min(1) @Max(2_147_483_647) templateVersion!: number;
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) rootName?: string;
  @IsObject() variables!: Record<string, unknown>;
  @IsBoolean() collaborationEnabled!: boolean;
  @IsOptional() @IsObject() collaborationInputs?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @Validate(RunParticipantBindingShapes)
  @ValidateNested({ each: true })
  @Type(() => RunParticipantBindingDto) roleBindings?: RunParticipantBindingDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  enabledTaskNodeIds?: string[];
  @IsOptional() @DecimalRevision() expectedTreeRevision?: string;
  @IsOptional() @IsString() @MaxLength(128) targetParentFolderId?: string | null;
}

export class InstantiateCompositeTemplateDto extends PreviewCompositeTemplateDto {
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
  @IdempotencyKey() idempotencyKey!: string;
}

export class FolderSnapshotRoleDto {
  @IsString() @MinLength(1) @MaxLength(128) pageId!: string;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MinLength(1) @MaxLength(128) roleSlotKey!: string | null;
}

export class LegacyTaskTargetDto {
  @IsString() @MinLength(1) @MaxLength(128) taskNodeId!: string;
  @IsString() @MinLength(1) @MaxLength(128) pageId!: string;
}

@ValidatorConstraint({ name: 'folderWorkflowSourceShape', async: false })
class FolderWorkflowSourceShape implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    const allowed = item.kind === 'structure_only' || item.kind === 'simple_pages'
      ? ['kind']
      : item.kind === 'template'
        ? ['kind', 'versionId']
        : item.kind === 'legacy_workflow'
          ? ['kind', 'templateId', 'version', 'taskTargets']
          : [];
    return allowed.length > 0 && Object.keys(item).every((key) => allowed.includes(key));
  }
}

export class FolderWorkflowSourceDto {
  @IsIn(['structure_only', 'template', 'legacy_workflow', 'simple_pages'])
  kind!: 'structure_only' | 'template' | 'legacy_workflow' | 'simple_pages';
  @ValidateIf((value: FolderWorkflowSourceDto) => value.kind === 'template')
  @IsString() @MinLength(1) @MaxLength(128) versionId?: string;
  @ValidateIf((value: FolderWorkflowSourceDto) => value.kind === 'legacy_workflow')
  @IsString() @MinLength(1) @MaxLength(128) templateId?: string;
  @ValidateIf((value: FolderWorkflowSourceDto) => value.kind === 'legacy_workflow')
  @IsInt() @Min(1) @Max(2_147_483_647) version?: number;
  @ValidateIf((value: FolderWorkflowSourceDto) => value.kind === 'legacy_workflow')
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => LegacyTaskTargetDto) taskTargets?: LegacyTaskTargetDto[];
}

export class FolderSnapshotSelectionDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) excludedFolderIds!: string[];
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) excludedPageIds!: string[];
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => FolderSnapshotRoleDto) roleSlotsByPage?: FolderSnapshotRoleDto[];
  @IsObject() @Validate(FolderWorkflowSourceShape) @ValidateNested()
  @Type(() => FolderWorkflowSourceDto) source!: FolderWorkflowSourceDto;
}

export class FolderSnapshotPreviewDto {
  @IsString() @MinLength(1) @MaxLength(128) rootFolderId!: string;
  @IsObject() @ValidateNested() @Type(() => FolderSnapshotSelectionDto)
  selection!: FolderSnapshotSelectionDto;
}

export class SaveFolderTemplateDto extends FolderSnapshotPreviewDto {
  @IsObject() sourceToken!: Record<string, unknown>;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) acknowledgedWarnings!: string[];
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @PreserveRawInput() @IsString() @MaxLength(240) description?: string;
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsEnum(PageTemplateCategory) category!: PageTemplateCategory;
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
}

export class UpgradeTargetDto {
  @IsString() @MinLength(1) @MaxLength(128) taskNodeId!: string;
  @IsString() @MinLength(1) @MaxLength(128) pageNodeId!: string;
}

export class UpgradeNodeDto {
  @IsObject() value!: Record<string, unknown>;
}

export class UpgradeLegacyWorkflowDto {
  @IsInt() @Min(1) @Max(2_147_483_647) expectedLegacyVersion!: number;
  @Matches(/^[a-f0-9]{64}$/u) expectedLegacyDefinitionHash!: string;
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @PreserveRawInput() @IsString() @MaxLength(240) description?: string;
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsEnum(PageTemplateCategory) category!: PageTemplateCategory;
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) nodes!: Record<string, unknown>[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => UpgradeTargetDto) taskTargets!: UpgradeTargetDto[];
}

export class PageBindingEditDto {
  @IsString() @MinLength(1) @MaxLength(128) pageId!: string;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MinLength(1) @MaxLength(128) agentId!: string | null;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MinLength(1) @MaxLength(128) roleSlotKey!: string | null;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MaxLength(64) expectedUpdatedAt!: string | null;
}

export class PageBindingMutationDto {
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MinLength(1) @MaxLength(128) agentId!: string | null;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MinLength(1) @MaxLength(128) roleSlotKey!: string | null;
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MaxLength(64) expectedUpdatedAt!: string | null;
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
}

export class DeletePageBindingDto {
  @IsDefined() @ValidateIf((_object, value) => value !== null)
  @IsString() @MaxLength(64) expectedUpdatedAt!: string | null;
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
}

export class FolderBindingPreviewDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) pageIds?: string[];
}

export class FolderBindingMutationDto {
  @IsDefined() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) pageIds!: string[];
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
  @IsDefined() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => PageBindingEditDto) edits!: PageBindingEditDto[];
}

@ValidatorConstraint({ name: 'existingRunSourceShape', async: false })
class ExistingRunSourceShape implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    const allowed = item.kind === 'page_selection'
      ? ['kind']
      : item.kind === 'template_instantiation'
        ? ['kind', 'sourceInstantiationId']
        : [];
    return allowed.length > 0 && Object.keys(item).every((key) => allowed.includes(key));
  }
}

export class ExistingRunSourceDto {
  @IsIn(['page_selection', 'template_instantiation']) kind!: 'page_selection' | 'template_instantiation';
  @ValidateIf((value: ExistingRunSourceDto) => value.kind === 'template_instantiation')
  @IsString() @MinLength(1) @MaxLength(128) sourceInstantiationId?: string;
}

export class ExistingRunPreviewDto {
  @IsObject() @Validate(ExistingRunSourceShape) @ValidateNested()
  @Type(() => ExistingRunSourceDto) source!: ExistingRunSourceDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) pageIds!: string[];
  @IsObject() collaborationInputs!: Record<string, unknown>;
  @IsArray() @ArrayMaxSize(100) @Validate(RunParticipantBindingShapes)
  @ValidateNested({ each: true })
  @Type(() => RunParticipantBindingDto) bindings!: RunParticipantBindingDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) enabledTaskNodeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => PageBindingEditDto) bindingEdits?: PageBindingEditDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => FolderSnapshotRoleDto) roleSlotsByPage?: FolderSnapshotRoleDto[];
}

export class ExistingRunStartDto extends ExistingRunPreviewDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
  @IdempotencyKey() idempotencyKey!: string;
}

export class PageRunPreviewDto {
  @IsOptional() @IsObject() collaborationInputs: Record<string, unknown> = {};
  @IsOptional() @IsArray() @ArrayMaxSize(100) @Validate(RunParticipantBindingShapes)
  @ValidateNested({ each: true })
  @Type(() => RunParticipantBindingDto) bindings: RunParticipantBindingDto[] = [];
  @IsOptional() @IsArray() @ArrayMaxSize(1) @ValidateNested({ each: true })
  @Type(() => PageBindingEditDto) bindingEdits?: PageBindingEditDto[];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) roleSlotKey?: string;
}

export class PageRunStartDto extends PageRunPreviewDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsDefined() @DecimalRevision() expectedTreeRevision!: string;
  @IdempotencyKey() idempotencyKey!: string;
}
