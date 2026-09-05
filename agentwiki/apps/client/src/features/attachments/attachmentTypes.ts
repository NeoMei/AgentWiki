export type AttachmentStatus = 'active' | 'archived';
export type AttachmentListStatus = AttachmentStatus | 'all';

export interface AttachmentSummary {
  id: string;
  spaceId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: bigint;
  width: number;
  height: number;
  status: AttachmentStatus;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AttachmentListResult {
  items: AttachmentSummary[];
  total: number;
  skip: number;
  take: number;
}

export interface AttachmentListQuery {
  q?: string;
  status?: AttachmentListStatus;
  skip?: number;
  take?: number;
}

export interface AttachmentUploadOptions {
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
}

export interface AttachmentImpactedPage {
  id: string;
  title: string;
}

export interface AttachmentRenamePreview {
  attachmentId: string;
  displayName: string;
  path: string;
  previewToken: string;
  impactedPages: AttachmentImpactedPage[];
}

export interface AttachmentRenameConfirm { previewToken: string }

export interface AttachmentRenameResult extends AttachmentSummary {
  path: string;
  impactedPages: AttachmentImpactedPage[];
}
