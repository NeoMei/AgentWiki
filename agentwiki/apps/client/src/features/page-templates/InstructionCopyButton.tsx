import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTemplateEntryLanguage } from './useTemplateEntryLanguage';
import './InstructionCopyButton.css';

/** A changed instruction gets fresh feedback, even while an older clipboard write is pending. */
export function InstructionCopyButton({ text }: { text: string }) {
  return <InstructionCopyAction key={text} text={text} />;
}

function InstructionCopyAction({ text }: { text: string }) {
  const { t } = useTemplateEntryLanguage();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const mounted = useRef(false);
  const copying = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = window.setTimeout(() => setState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    if (copying.current) return;
    copying.current = true;
    setState('copying');
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) setState('copied');
    } catch {
      if (mounted.current) setState('error');
    } finally {
      copying.current = false;
    }
  }

  const label = state === 'copied' ? t('pageTemplate.copyInstruction.copied')
    : state === 'copying' ? t('pageTemplate.copyInstruction.copying') : t('common.copy');
  return <div className="instruction-copy-control">
    <button type="button" onClick={() => void copy()} className="instruction-copy-button" data-state={state}
      disabled={state === 'copying'} aria-busy={state === 'copying'} title={t('collaboration.wizard.copyInstruction')}>
      {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{label}</span>
    </button>
    <span role="status" className="sr-only">{state === 'copied' ? t('collaboration.wizard.copied') : ''}</span>
    {state === 'error' ? <p role="alert" className="instruction-copy-error">{t('pageTemplate.copyInstruction.failed')}</p> : null}
  </div>;
}
