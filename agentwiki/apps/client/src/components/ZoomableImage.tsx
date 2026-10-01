import { X } from 'lucide-react';
import React, { useId, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { ModalDialog } from './ModalDialog';

/** Receives an already accepted image URL. Owns no fetching or Blob URL lifecycle. */
export const ZoomableImage: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ src, alt = '', ...props }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const label = alt.trim() || t('markdown.image.unnamed');
  return <>
    <button ref={trigger} type="button" aria-label={t('markdown.image.enlarge', { name: label })}
      className="inline-block max-w-full cursor-zoom-in rounded-lg text-left align-middle focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>
      <img {...props} src={src} alt={alt} />
    </button>
    {open && <ModalDialog labelledBy={titleId} onRequestClose={() => setOpen(false)} returnFocusTo={trigger.current}
      className="flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[14px] border bg-white p-4">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 id={titleId} className="text-xl font-semibold">{t('markdown.image.preview')}</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label={t('markdown.image.close')}
          className="h-8 w-8 shrink-0 rounded-lg hover:bg-gray-100"><X size={20} className="mx-auto" /></button>
      </div>
      <img src={src} alt={alt} referrerPolicy={props.referrerPolicy} decoding="async"
        className="min-h-0 max-w-full self-center object-contain"
        style={{ maxHeight: 'calc(100dvh - 8rem)', width: 'auto', height: 'auto' }} />
    </ModalDialog>}
  </>;
};
