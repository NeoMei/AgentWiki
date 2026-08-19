import React from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export const Toast: React.FC<{
  kind: 'success' | 'error';
  message: string;
  onClose: () => void;
}> = ({ kind, message, onClose }) => {
  const { t } = useLanguage();
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`fixed right-4 top-20 z-[70] flex max-w-sm items-start gap-3 rounded-xl border bg-white p-4 shadow-lg ${kind === 'error' ? 'border-red-200 text-red-700' : 'border-green-200 text-green-700'}`}
    >
      {kind === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
      <p className="min-w-0 flex-1 text-sm leading-5">{message}</p>
      <button type="button" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
    </div>
  );
};
