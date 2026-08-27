import React, { useEffect, useState } from 'react';
import { fetchAttachmentBlob } from './attachmentApi';

export interface AttachmentImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'width' | 'height'> {
  attachmentId: string;
  displayName: string;
  alt?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; url: string };

export const AttachmentImage: React.FC<AttachmentImageProps> = ({
  attachmentId,
  displayName,
  alt,
  mimeType: _mimeType,
  width,
  height,
  className = '',
  style,
  ...imageProps
}) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const validDimensions = Number.isSafeInteger(width) && Number.isSafeInteger(height) && width! > 0 && height! > 0;
  const frameStyle = {
    ...style,
    ...(validDimensions ? { aspectRatio: `${width} / ${height}` } : {}),
  };

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    let currentUrl: string | null = null;
    setState({ status: 'loading' });

    void fetchAttachmentBlob(attachmentId, controller.signal).then((blob) => {
      if (!current) return;
      currentUrl = URL.createObjectURL(blob);
      setState({ status: 'ready', url: currentUrl });
    }).catch(() => {
      if (current && !controller.signal.aborted) setState({ status: 'error' });
    });

    return () => {
      current = false;
      controller.abort();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [attachmentId]);

  const accessibleAlt = alt?.trim() || displayName;
  if (state.status === 'loading') {
    return <span role="status" aria-label={accessibleAlt} className={`inline-flex min-h-16 max-w-full items-center justify-center overflow-hidden rounded border bg-gray-50 text-sm text-gray-500 ${className}`} style={frameStyle}>{displayName}</span>;
  }
  if (state.status === 'error') {
    return <span role="alert" aria-label={accessibleAlt} className={`inline-flex min-h-16 max-w-full items-center justify-center overflow-hidden rounded border border-red-200 bg-red-50 text-sm text-red-700 ${className}`} style={frameStyle}>{accessibleAlt}</span>;
  }
  return <img {...imageProps} src={state.url} alt={accessibleAlt} width={validDimensions ? width : undefined} height={validDimensions ? height : undefined} className={`max-w-full ${className}`} style={frameStyle} />;
};
