import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollaborationInputValuesSchema } from '@neomei/agentwiki-sync-protocol';
import { ArrowLeft, CheckCircle2, Copy } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { SpaceNav } from '../../components/SpaceNav';
import { Toast } from '../../components/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { RoleBindingEditor } from './components/RoleBindingEditor';
import type {
  AgentInstruction,
  CollaborationRun,
  RoleBinding,
  SpaceMemberSummary,
  TemplateDetail,
} from './types';

type Step = 1 | 2 | 3;
type RetryAction = 'input' | 'mapping' | 'start' | null;

export function buildAgentJoinInstructions(run: { id: string; roleBindings: RoleBinding[] }): AgentInstruction[] {
  const byAgent = new Map<string, string[]>();
  for (const binding of run.roleBindings) {
    const name = binding.roleSlotName || binding.roleSlotId;
    byAgent.set(binding.agentId, [...(byAgent.get(binding.agentId) ?? []), name]);
  }
  return [...byAgent.entries()].map(([agentId, roleSlots]) => ({
    agentId,
    roleSlots,
    text: `Run ${run.id}. Roles: ${roleSlots.join(', ')}. Use the existing AgentWiki MCP connection. Call wiki_collaboration_join_run with runId ${run.id}, then call wiki_collaboration_next_action and follow each action until waiting_human, paused, completed, failed, or cancelled. Never invent or request a new connection secret.`,
  }));
}

export const RunStartWizard: React.FC = () => {
  const { id = '', templateId = '' } = useParams<{ id: string; templateId: string }>();
  const { t } = useLanguage();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [agents, setAgents] = useState<SpaceMemberSummary[]>([]);
  const [run, setRun] = useState<CollaborationRun | null>(null);
  const [started, setStarted] = useState<CollaborationRun | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [runName, setRunName] = useState('');
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [bindings, setBindings] = useState<RoleBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [idempotencyKey] = useState(() => `start-${safeUuid()}`);
  const storageKey = `agentwiki.collaboration.draft.${id}.${templateId}`;

  const initialize = useCallback(async () => {
    if (!id || !templateId) return;
    setLoading(true);
    try {
      const [nextTemplate, members] = await Promise.all([
        collaborationApi.getTemplate(id, templateId),
        collaborationApi.listMembers(id),
      ]);
      setTemplate(nextTemplate);
      setAgents(members.filter(isExecutableAgent));
      const storedRunId = localStorage.getItem(storageKey);
      if (storedRunId) {
        try {
          const existing = await collaborationApi.getRun(id, storedRunId);
          setRun(existing);
          setRunName(existing.name);
          setInputValues(existing.inputs);
          setBindings(existing.roleBindings);
          if (existing.status === 'ready') setStep(3);
          else if (existing.status === 'draft') setStep(2);
          else setStarted(existing);
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
    } catch {
      setToast({ kind: 'error', message: t('collaboration.wizard.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [id, storageKey, t, templateId]);

  useEffect(() => { void initialize(); }, [initialize]);

  const completeInputs = async (currentRun: CollaborationRun | null = run) => {
    if (!template || !runName.trim()) return;
    const normalized: Record<string, string | number | boolean> = {};
    for (const input of template.definition.inputs) {
      const value = inputValues[input.key];
      if (input.required && (value === undefined || value === '')) {
        setToast({ kind: 'error', message: t('collaboration.wizard.requiredInputs') });
        return;
      }
      if (value !== undefined && value !== '') normalized[input.key] = value;
    }
    const parsed = CollaborationInputValuesSchema.safeParse(normalized);
    if (!parsed.success) {
      setToast({ kind: 'error', message: t('collaboration.wizard.invalidInputs') });
      return;
    }
    setSubmitting(true);
    try {
      const draft = currentRun && ['draft', 'ready'].includes(currentRun.status)
        ? await collaborationApi.updateRunDraft(id, currentRun.id, { expectedVersion: currentRun.version, name: runName.trim(), inputs: parsed.data })
        : await collaborationApi.createRunDraft(id, { templateId, name: runName.trim(), inputs: parsed.data, roleBindings: [] });
      setRun(draft);
      localStorage.setItem(storageKey, draft.id);
      setRetryAction(null);
      setStep(2);
    } catch (error) {
      handleMutationError(error, 'input');
    } finally {
      setSubmitting(false);
    }
  };

  const completeMapping = async (currentRun: CollaborationRun | null = run) => {
    if (!template || !currentRun) return;
    if (template.definition.roleSlots.some((slot) => slot.required && !bindings.some((binding) => binding.roleSlotId === slot.id))) {
      setToast({ kind: 'error', message: t('collaboration.wizard.requiredBindings') });
      return;
    }
    setSubmitting(true);
    try {
      const roleBindings = bindings.map(({ roleSlotId, agentId }) => ({ roleSlotId, agentId }));
      const updated = await collaborationApi.updateRunDraft(id, currentRun.id, { expectedVersion: currentRun.version, roleBindings });
      const ready = await collaborationApi.validateRunDraft(id, currentRun.id, updated.version);
      setRun(ready);
      setRetryAction(null);
      setStep(3);
    } catch (error) {
      handleMutationError(error, 'mapping');
    } finally {
      setSubmitting(false);
    }
  };

  const start = async (currentRun: CollaborationRun | null = run) => {
    if (!currentRun) return;
    setSubmitting(true);
    try {
      const result = await collaborationApi.startRun(id, currentRun.id, { expectedVersion: currentRun.version, idempotencyKey });
      const enrichedBindings = result.roleBindings.map((binding) => ({
        ...binding,
        roleSlotName: binding.roleSlotName || template?.definition.roleSlots.find((slot) => slot.id === binding.roleSlotId)?.name || binding.roleSlotId,
      }));
      setStarted({ ...result, roleBindings: enrichedBindings });
      setRetryAction(null);
      localStorage.removeItem(storageKey);
    } catch (error) {
      handleMutationError(error, 'start');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMutationError = (error: unknown, action: Exclude<RetryAction, null>) => {
    if ((error as { response?: { status?: number } }).response?.status === 409) {
      setRetryAction(action);
      setToast({ kind: 'error', message: t('collaboration.wizard.conflict') });
    } else {
      setToast({ kind: 'error', message: t('collaboration.wizard.actionFailed') });
    }
  };

  const retry = async () => {
    const action = retryAction;
    if (!action || !run) return;
    setSubmitting(true);
    try {
      const latest = await collaborationApi.getRun(id, run.id);
      setRun(latest);
      setRetryAction(null);
      if (!['draft', 'ready'].includes(latest.status)) {
        setStarted(latest);
        localStorage.removeItem(storageKey);
        setSubmitting(false);
        return;
      }
      if (action === 'input') await completeInputs(latest);
      else if (action === 'mapping') await completeMapping(latest);
      else await start(latest);
    } catch {
      setToast({ kind: 'error', message: t('collaboration.wizard.actionFailed') });
      setSubmitting(false);
    }
  };

  const instructions = useMemo(() => started ? buildAgentJoinInstructions(started) : [], [started]);
  const hasSelfReview = instructions.some((instruction) => instruction.roleSlots.length > 1);

  if (loading || !template) return <div data-testid="run-wizard-loading" className="py-14 text-center text-sm text-gray-500">{t('common.loading')}</div>;

  return (
    <div className="mx-auto max-w-4xl min-w-0">
      <SpaceNav spaceId={id} />
      <Link to={`/spaces/${id}/collaboration`} className="inline-flex items-center gap-1 text-sm text-gray-500"><ArrowLeft size={15} />{t('collaboration.title')}</Link>
      <div className="mt-3"><h1 className="text-2xl font-semibold">{t('collaboration.wizard.title')}</h1><p className="mt-1 text-sm text-gray-600">{template.name}</p></div>
      <ol aria-label={t('collaboration.wizard.progress')} className="mt-6 grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
        {[1, 2, 3].map((value) => <li key={value} className={`rounded-lg border px-2 py-2 ${step === value ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : value < step || started ? 'border-green-200 bg-green-50 text-green-700' : 'text-gray-500'}`}>{value}. {t(`collaboration.wizard.step${value}Short`)}</li>)}
      </ol>

      <div className="mt-6">
        {!started && step === 1 ? <InputStep template={template} runName={runName} onRunName={setRunName} values={inputValues} onValues={setInputValues} t={t} /> : null}
        {!started && step === 2 ? <section><h2 className="text-xl font-semibold">{t('collaboration.wizard.step2')}</h2><p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step2Help')}</p><div className="mt-5"><RoleBindingEditor roleSlots={template.definition.roleSlots} agents={agents} bindings={bindings} onChange={setBindings} chooseLabel={t('collaboration.wizard.chooseAgent')} /></div>{!agents.length ? <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('collaboration.wizard.noAgents')}</p> : null}</section> : null}
        {!started && step === 3 && run ? <ReviewStep template={template} run={run} bindings={bindings} agents={agents} t={t} /> : null}
        {started ? <StartedStep started={started} instructions={instructions} hasSelfReview={hasSelfReview} onCopy={(text) => void copyInstruction(text, setToast, t)} t={t} spaceId={id} /> : null}
      </div>

      {!started ? <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5"><button type="button" disabled={submitting || step === 1} onClick={() => setStep((current) => current === 3 ? 2 : 1)} className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-40">{t('common.back')}</button><div className="flex items-center gap-2">{retryAction ? <button type="button" onClick={() => void retry()} disabled={submitting} className="min-h-10 rounded-lg border border-amber-300 px-4 text-sm text-amber-800">{t('collaboration.wizard.retryConflict')}</button> : null}<button type="button" disabled={submitting} onClick={() => step === 1 ? void completeInputs() : step === 2 ? void completeMapping() : void start()} className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{submitting ? t('collaboration.wizard.working') : step === 3 ? t('collaboration.start') : t('common.next')}</button></div></div> : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
    </div>
  );
};

const InputStep: React.FC<{ template: TemplateDetail; runName: string; onRunName: (name: string) => void; values: Record<string, string | number | boolean>; onValues: (values: Record<string, string | number | boolean>) => void; t: (key: string) => string }> = ({ template, runName, onRunName, values, onValues, t }) => <section><h2 className="text-xl font-semibold">{t('collaboration.wizard.step1')}</h2><p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step1Help')}</p><div className="mt-5 space-y-4 rounded-xl border bg-white p-5"><label className="block text-sm font-medium">{t('collaboration.wizard.runName')}<input aria-label={t('collaboration.wizard.runName')} value={runName} onChange={(event) => onRunName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>{template.definition.inputs.map((input) => <InputControl key={input.key} input={input} value={values[input.key]} onChange={(value) => onValues({ ...values, [input.key]: value })} />)}</div></section>;

const InputControl: React.FC<{ input: TemplateDetail['definition']['inputs'][number]; value: string | number | boolean | undefined; onChange: (value: string | number | boolean) => void }> = ({ input, value, onChange }) => <label className="block text-sm font-medium">{input.label}{input.required ? <span className="ml-1 text-red-600">*</span> : null}{input.type === 'long_text' ? <textarea aria-label={input.label} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border p-3" /> : input.type === 'boolean' ? <input aria-label={input.label} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="ml-3" /> : <input aria-label={input.label} type={input.type === 'number' ? 'number' : input.type === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(input.type === 'number' ? Number(event.target.value) : event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" />}</label>;

const ReviewStep: React.FC<{ template: TemplateDetail; run: CollaborationRun; bindings: RoleBinding[]; agents: SpaceMemberSummary[]; t: (key: string) => string }> = ({ template, run, bindings, agents, t }) => <section><h2 className="text-xl font-semibold">{t('collaboration.wizard.step3')}</h2><p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step3Help')}</p><dl className="mt-5 divide-y rounded-xl border bg-white"><div className="p-4"><dt className="text-xs text-gray-500">{t('collaboration.wizard.runName')}</dt><dd className="mt-1 font-medium">{run.name}</dd></div><div className="p-4"><dt className="text-xs text-gray-500">{t('collaboration.templates')}</dt><dd className="mt-1 font-medium">{template.name}</dd></div>{bindings.map((binding) => <div key={binding.roleSlotId} className="p-4"><dt className="text-xs text-gray-500">{template.definition.roleSlots.find((slot) => slot.id === binding.roleSlotId)?.name}</dt><dd className="mt-1 font-medium">{agents.find((agent) => agent.agentId === binding.agentId)?.agent?.name}</dd></div>)}</dl></section>;

const StartedStep: React.FC<{ started: CollaborationRun; instructions: AgentInstruction[]; hasSelfReview: boolean; onCopy: (text: string) => void; t: (key: string) => string; spaceId: string }> = ({ started, instructions, hasSelfReview, onCopy, t, spaceId }) => <section><div className="flex items-center gap-3"><CheckCircle2 className="text-green-600" /><div><h2 className="text-xl font-semibold">{t('collaboration.wizard.started')}</h2><p className="text-sm text-gray-600">{started.name}</p></div></div>{hasSelfReview ? <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('collaboration.wizard.selfReview')}</p> : null}<div className="mt-5 space-y-4">{instructions.map((instruction) => <article key={instruction.agentId} className="rounded-xl border bg-white p-4"><h3 className="font-medium">{instruction.roleSlots.join(', ')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{instruction.text}</p><button type="button" onClick={() => onCopy(instruction.text)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><Copy size={15} />{t('collaboration.wizard.copyInstruction')}</button></article>)}</div><Link to={`/spaces/${spaceId}/collaboration/runs/${started.id}`} className="mt-6 inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">{t('collaboration.wizard.openRun')}</Link></section>;

function isExecutableAgent(member: SpaceMemberSummary): boolean {
  return member.type === 'agent' && !!member.agentId && !!member.agent
    && member.agent.status === 'active' && !member.agent.revokedAt
    && (member.role === 'editor' || member.role === 'publisher');
}

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function copyInstruction(text: string, setToast: (toast: { kind: 'success' | 'error'; message: string }) => void, t: (key: string) => string) {
  try {
    await navigator.clipboard.writeText(text);
    setToast({ kind: 'success', message: t('collaboration.wizard.copied') });
  } catch {
    setToast({ kind: 'error', message: t('collaboration.wizard.copyFailed') });
  }
}
