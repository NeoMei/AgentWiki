import { useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import { normalizeSpaceApprovalPolicy, type CanonicalSpaceApprovalPolicy } from '../../api/space-types';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { announceSpaceReviewPolicyChange, listenSpaceReviewPolicyChanges } from './spaceReviewPolicyEvents';
import './SpaceReviewPolicy.css';

const copy = {
  'zh-CN': { title: '内容审核', none: '无需审核', always: '始终审核', noReviewHelp: '有写入权限的 Agent 可在已有授权范围内直接发布，适合日常协作。', alwaysHelp: 'Agent 提交的变更先进入待审核，由人工确认后发布。', scope: '仅影响之后提交的变更。已有待审内容仍需单独处理，成员权限不会改变。', owner: '仅空间所有者可以修改审核方式。', save: '保存审核方式', saved: '审核方式已保存', recommended: '默认', change: '更改' },
  en: { title: 'Content review', none: 'No review', always: 'Always review', noReviewHelp: 'Write-capable Agents publish within existing scopes, suitable for everyday collaboration.', alwaysHelp: 'Agent changes wait for human review before publication.', scope: 'Applies to future submissions. Existing pending changes still need separate review; member permissions stay the same.', owner: 'Only the Space owner can change the review policy.', save: 'Save review policy', saved: 'Review policy saved', recommended: 'Default', change: 'Change' },
};

export function ReviewPolicyOptions({ value, onChange, disabled = false }: { value: CanonicalSpaceApprovalPolicy; onChange: (value: CanonicalSpaceApprovalPolicy) => void; disabled?: boolean }) {
  const { language } = useLanguage(); const labels = copy[language]; const id = useId();
  return <fieldset className="space-review-options" disabled={disabled}><legend>{labels.title}</legend>
    {(['no-review', 'always-review'] as const).map(policy => <label key={policy} className="space-review-option" data-selected={value === policy}>
      <input type="radio" name={id} value={policy} checked={value === policy} data-modal-autofocus={value === policy || undefined} onChange={() => onChange(policy)} aria-labelledby={`${id}-${policy}`} aria-describedby={`${id}-${policy}-help`} />
      <span><span className="space-review-option-title" id={`${id}-${policy}`}>{policy === 'no-review' ? labels.none : labels.always}</span>
        {policy === 'no-review' ? <span className="space-review-default" aria-hidden="true">{labels.recommended}</span> : null}
        <span className="space-review-option-help" id={`${id}-${policy}-help`}>{policy === 'no-review' ? labels.noReviewHelp : labels.alwaysHelp}</span></span>
    </label>)}
  </fieldset>;
}

interface PolicyProps { spaceId: string; actorId?: string; approvalPolicy: unknown; canEdit: boolean }
function usePolicy({ spaceId, actorId, approvalPolicy }: PolicyProps) {
  const [policy, setPolicy] = useState(() => normalizeSpaceApprovalPolicy(approvalPolicy));
  useEffect(() => setPolicy(normalizeSpaceApprovalPolicy(approvalPolicy)), [approvalPolicy]);
  useEffect(() => listenSpaceReviewPolicyChanges(spaceId, actorId, setPolicy), [spaceId, actorId]);
  return policy;
}
function PolicyEditor({ spaceId, actorId, policy, onSaved, onBusyChange }: Pick<PolicyProps, 'spaceId' | 'actorId'> & { policy: CanonicalSpaceApprovalPolicy; onSaved?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { language, t } = useLanguage(); const labels = copy[language];
  const [draft, setDraft] = useState(policy); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false); const [error, setError] = useState('');
  const active = useRef(false); const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setDraft(policy); }, [policy]);
  async function save() {
    if (inFlight.current || draft === policy) return;
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setError(''); setSaved(false);
    try {
      await api.patch(`/spaces/${encodeURIComponent(spaceId)}`, { approvalPolicy: draft });
      if (!active.current) return;
      announceSpaceReviewPolicyChange({ spaceId, actorId, approvalPolicy: draft }); setSaved(true); onSaved?.();
    } catch (reason) { if (active.current) setError(apiErrorMessage(reason, t, 'settings.saveFailed')); }
    finally { inFlight.current = false; if (active.current) { setBusy(false); onBusyChange?.(false); } }
  }
  return <div className="space-review-editor">
    <ReviewPolicyOptions value={draft} onChange={value => { setDraft(value); setSaved(false); setError(''); }} disabled={busy} />
    <p className="space-review-help">{t('settings.approvalHelp')}</p>
    <p className="space-review-help">{labels.scope}</p>
    {error ? <p role="alert" className="space-review-error">{error}</p> : null}
    <div className="space-review-actions"><button type="button" onClick={() => void save()} disabled={busy || draft === policy} className="space-review-save">{busy ? t('common.saving') : labels.save}</button>
      {saved ? <span role="status" className="space-review-saved">{labels.saved}</span> : null}</div>
  </div>;
}

export function SpaceReviewPolicyCard(props: PolicyProps) { return <PolicyCard key={`${props.actorId}:${props.spaceId}`} {...props} />; }
function PolicyCard(props: PolicyProps) {
  const { language } = useLanguage(); const labels = copy[language]; const policy = usePolicy(props);
  return <section aria-label={labels.title} className="space-review-card">
    {props.canEdit ? <PolicyEditor spaceId={props.spaceId} actorId={props.actorId} policy={policy} /> : <>
      <h2>{labels.title}</h2><p className="space-review-readonly">{policy === 'no-review' ? labels.none : labels.always}</p><p className="space-review-help">{labels.owner}</p><p className="space-review-help">{labels.scope}</p>
    </>}
  </section>;
}
export function SpaceReviewPolicyStatus(props: PolicyProps) { return <PolicyStatus key={`${props.actorId}:${props.spaceId}:${props.canEdit}`} {...props} />; }
function PolicyStatus(props: PolicyProps) {
  const { language, t } = useLanguage(); const labels = copy[language]; const policy = usePolicy(props); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const id = useId(); const opener = useRef<HTMLButtonElement>(null);
  const Icon = policy === 'no-review' ? ShieldCheck : ShieldQuestion; const label = policy === 'no-review' ? labels.none : labels.always;
  return <div className="space-review-status">
    {props.canEdit ? <button ref={opener} type="button" onClick={() => setOpen(true)} aria-label={`${labels.title}：${label}`} aria-haspopup="dialog" title={labels.change} className="space-review-badge"><Icon size={14} aria-hidden="true" />{label}</button>
      : <span className="space-review-badge" title={`${labels.title} · ${labels.owner}`}><Icon size={14} aria-hidden="true" />{label}</span>}
    {open ? <ModalDialog labelledBy={id} onRequestClose={() => { if (!busy) setOpen(false); }} closeDisabled={busy} returnFocusTo={opener.current} className="space-review-dialog">
      <h2 id={id}>{labels.title}</h2><PolicyEditor spaceId={props.spaceId} actorId={props.actorId} policy={policy} onSaved={() => setOpen(false)} onBusyChange={setBusy} />
      <button type="button" className="space-review-cancel" disabled={busy} onClick={() => { if (!busy) setOpen(false); }}>{t('common.cancel')}</button>
    </ModalDialog> : null}
  </div>;
}
