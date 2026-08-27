import api from '../../api/client';
import type {
  AttachmentListQuery,
  AttachmentListResult,
  AttachmentStatus,
  AttachmentSummary,
  AttachmentUploadOptions,
} from './attachmentTypes';

const invalidResponse = () => new Error('Invalid attachment response');

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringField = (record: Record<string, unknown>, name: string): string => {
  const value = record[name];
  if (typeof value !== 'string' || !value) throw invalidResponse();
  return value;
};

const nullableStringField = (record: Record<string, unknown>, name: string): string | null => {
  const value = record[name];
  if (value === null) return null;
  if (typeof value !== 'string' || !value) throw invalidResponse();
  return value;
};

const safeIntegerField = (record: Record<string, unknown>, name: string, minimum: number): number => {
  const value = record[name];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw invalidResponse();
  return value as number;
};

const sizeField = (record: Record<string, unknown>): bigint => {
  const value = record.sizeBytes;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw invalidResponse();
  return BigInt(value);
};

const normalizeAttachment = (value: unknown): AttachmentSummary => {
  if (!isRecord(value)) throw invalidResponse();
  const status = value.status;
  if (status !== 'active' && status !== 'archived') throw invalidResponse();
  return {
    id: stringField(value, 'id'),
    spaceId: stringField(value, 'spaceId'),
    displayName: stringField(value, 'displayName'),
    mimeType: stringField(value, 'mimeType'),
    sizeBytes: sizeField(value),
    width: safeIntegerField(value, 'width', 1),
    height: safeIntegerField(value, 'height', 1),
    status: status as AttachmentStatus,
    uploadedByUserId: nullableStringField(value, 'uploadedByUserId'),
    createdAt: stringField(value, 'createdAt'),
    updatedAt: stringField(value, 'updatedAt'),
    archivedAt: nullableStringField(value, 'archivedAt'),
  };
};

const encoded = (value: string) => encodeURIComponent(value);

export async function listAttachments(
  spaceId: string,
  query: AttachmentListQuery = {},
  signal?: AbortSignal,
): Promise<AttachmentListResult> {
  const response = await api.get(`/spaces/${encoded(spaceId)}/attachments`, {
    params: {
      q: query.q,
      status: query.status ?? 'active',
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    },
    signal,
  });
  if (!isRecord(response.data) || !Array.isArray(response.data.items)) throw invalidResponse();
  return {
    items: response.data.items.map(normalizeAttachment),
    total: safeIntegerField(response.data, 'total', 0),
    skip: safeIntegerField(response.data, 'skip', 0),
    take: safeIntegerField(response.data, 'take', 1),
  };
}

export async function uploadAttachment(
  spaceId: string,
  file: File,
  options: AttachmentUploadOptions = {},
): Promise<AttachmentSummary> {
  const body = new FormData();
  body.append('file', file);
  const response = await api.post(`/spaces/${encoded(spaceId)}/attachments`, body, {
    // Removing the shared JSON default lets the browser add the multipart boundary.
    headers: { 'Content-Type': undefined },
    signal: options.signal,
    onUploadProgress: options.onProgress ? (event) => {
      const total = event.total;
      if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return;
      const loaded = Number.isFinite(event.loaded) ? Math.max(0, event.loaded) : 0;
      options.onProgress?.(Math.min(100, Math.max(0, Math.round((loaded / total) * 100))));
    } : undefined,
  });
  return normalizeAttachment(response.data);
}

const changeAttachmentState = async (
  action: 'archive' | 'restore',
  spaceId: string,
  attachmentId: string,
  expectedUpdatedAt: string,
  signal?: AbortSignal,
): Promise<AttachmentSummary> => {
  const response = await api.post(
    `/spaces/${encoded(spaceId)}/attachments/${encoded(attachmentId)}/${action}`,
    { expectedUpdatedAt },
    { signal },
  );
  return normalizeAttachment(response.data);
};

export const archiveAttachment = (
  spaceId: string,
  attachmentId: string,
  expectedUpdatedAt: string,
  signal?: AbortSignal,
) => changeAttachmentState('archive', spaceId, attachmentId, expectedUpdatedAt, signal);

export const restoreAttachment = (
  spaceId: string,
  attachmentId: string,
  expectedUpdatedAt: string,
  signal?: AbortSignal,
) => changeAttachmentState('restore', spaceId, attachmentId, expectedUpdatedAt, signal);

export async function fetchAttachmentBlob(attachmentId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await api.get(`/attachments/${encoded(attachmentId)}/content`, {
    responseType: 'blob',
    signal,
  });
  if (!(response.data instanceof Blob)) throw invalidResponse();
  return response.data;
}
