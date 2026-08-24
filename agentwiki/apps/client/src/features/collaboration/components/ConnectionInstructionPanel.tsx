import React from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import type { PreparedAgent } from '../prepareAgent';

export interface ConnectionInstructionPanelProps {
  busy: boolean;
  copied: boolean;
  expired: boolean;
  onCheckNow: () => void;
  onConnectLater: () => void;
  onCopy: () => void;
  onRetryInstruction: () => void;
  remaining: string;
  result: PreparedAgent | null;
}

export const ConnectionInstructionPanel: React.FC<ConnectionInstructionPanelProps> = ({
  busy,
  copied,
  expired,
  onCheckNow,
  onConnectLater,
  onCopy,
  onRetryInstruction,
  remaining,
  result,
}) => {
  const { t } = useLanguage();

  if (result?.connection.kind === 'instruction_failed') {
    return (
      <section className="mt-5 min-w-0 rounded-[14px] border bg-gray-50 p-4">
        <p role="alert" className="text-sm text-red-700">
          {t('collaboration.agentPreparation.instructionFailed')}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onRetryInstruction}
          className="mt-3 min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
        >
          {t('collaboration.agentPreparation.retryInstruction')}
        </button>
      </section>
    );
  }

  if (result?.connection.kind === 'waiting') {
    return (
      <section className="mt-5 min-w-0 rounded-[14px] border bg-gray-50 p-4">
        <p
          role="status"
          aria-live="polite"
          className={`text-sm font-medium ${expired ? 'text-red-700' : 'text-gray-900'}`}
        >
          {expired
            ? t('collaboration.agentPreparation.expired')
            : t('collaboration.agentPreparation.waiting')}
        </p>
        {!expired ? (
          <p className="mt-1 text-sm text-gray-500">
            {t('agent.localSync.expiresIn', { remaining })}
          </p>
        ) : null}
        <pre className="mt-3 max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-white p-3 text-xs [overflow-wrap:anywhere]">
          {result.connection.installation.instructions}
        </pre>
        <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={busy || expired}
            onClick={onCopy}
            className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {copied
              ? t('collaboration.agentPreparation.copied')
              : t('collaboration.agentPreparation.copy')}
          </button>
          {expired ? (
            <button
              type="button"
              disabled={busy}
              onClick={onRetryInstruction}
              className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
            >
              {t('collaboration.agentPreparation.retryInstruction')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onCheckNow}
              className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
            >
              {t('collaboration.agentPreparation.checkNow')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onConnectLater}
            className="min-h-10 w-full rounded-lg bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            {t('collaboration.agentPreparation.connectLater')}
          </button>
        </div>
      </section>
    );
  }

  if (result?.connection.kind === 'connected') {
    return (
      <p role="status" aria-live="polite" className="mt-5 rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800">
        {t('collaboration.agentPreparation.connected')}
      </p>
    );
  }

  return null;
};
