import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { bugOperationsText } from '../../i18n/bug-operations-messages';

export const AgentArchiveDialog: React.FC<{
  agent: { id: string; name: string; status: string };
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ agent, onClose, onChanged }) => {
  const { language, t } = useLanguage();
  const op = (key: string) => bugOperationsText(language, key);
  const archived = agent.status === 'archived';
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/agents/${agent.id}/${archived ? 'restore' : 'archive'}`);
      if (!mountedRef.current) return;
      await onChanged();
      if (mountedRef.current) onClose();
    } catch {
      if (mountedRef.current) setError(op('operations.archiveFailed'));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };
  return <ModalDialog labelledBy="agent-archive-title" onRequestClose={onClose} closeDisabled={saving}
    className="w-full max-w-md rounded-[14px] border bg-white p-6 shadow-xl">
    <h2 id="agent-archive-title" className="text-xl font-semibold">{op(archived ? 'operations.restoreTitle' : 'operations.archiveTitle')}</h2>
    <p className="mt-3 break-all font-medium">{agent.name}</p>
    <p className="mt-3 text-sm text-gray-600">{op('operations.archiveHelp')}</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t('common.cancel')}</button>
      <button type="button" disabled={saving} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{saving ? t('common.loading') : op(archived ? 'operations.restoreConfirm' : 'operations.archiveConfirm')}</button>
    </div>
  </ModalDialog>;
};
