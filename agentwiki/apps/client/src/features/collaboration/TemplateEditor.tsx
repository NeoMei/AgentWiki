import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollaborationTemplateDefinitionSchema, type CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { Toast } from '../../components/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { FlowStepEditor } from './components/FlowStepEditor';
import { ValidationIssueList } from './components/ValidationIssueList';
import type { TemplateDetail, ValidationIssue } from './types';

const SECTIONS = ['overview', 'inputs', 'roles', 'flow', 'outputs'] as const;
type Section = typeof SECTIONS[number];

export interface TemplateEditorProps {
  mode: 'create' | 'edit';
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({ mode }) => {
  const { id = '', templateId = '' } = useParams<{ id: string; templateId: string }>();
  const creating = mode === 'create';
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [section, setSection] = useState<Section>('overview');
  const [template, setTemplate] = useState<TemplateDetail | null>(creating ? newTemplate(id, t) : null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    if (creating || !id || !templateId) return;
    setLoading(true);
    try {
      const next = await collaborationApi.getTemplate(id, templateId);
      setTemplate(next);
    } catch {
      setToast({ kind: 'error', message: t('collaboration.editor.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [creating, id, t, templateId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!template) return;
    const parsed = CollaborationTemplateDefinitionSchema.safeParse(template.definition);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message })));
      return;
    }
    let active = true;
    void collaborationApi.validateTemplate(id, parsed.data).then((result) => {
      if (active) setIssues(result.issues);
    }).catch(() => {
      if (active) setIssues([{ code: 'VALIDATION_UNAVAILABLE', message: t('collaboration.editor.validationUnavailable') }]);
    });
    return () => { active = false; };
  }, [id, t, template]);

  const updateDefinition = (definition: CollaborationTemplateDefinition) => {
    setTemplate((current) => current ? { ...current, definition } : current);
  };

  const save = async () => {
    if (!template || !template.name.trim()) return;
    const parsed = CollaborationTemplateDefinitionSchema.safeParse(template.definition);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message })));
      return;
    }
    setSaving(true);
    try {
      const validation = await collaborationApi.validateTemplate(id, parsed.data);
      if (!validation.valid) {
        setIssues(validation.issues);
        return;
      }
      const saved = creating
        ? await collaborationApi.createTemplate(id, {
          name: template.name.trim(), description: template.description.trim(), definition: parsed.data,
        })
        : await collaborationApi.updateTemplate(id, template.id, {
          expectedVersion: template.version,
          name: template.name.trim(),
          description: template.description.trim(),
          definition: parsed.data,
        });
      setTemplate(saved);
      setIssues([]);
      setToast({ kind: 'success', message: t('collaboration.editor.saved') });
      if (creating) navigate(`/spaces/${id}/collaboration/templates/${saved.id}`, { replace: true });
    } catch (error) {
      const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
      if (code === 'COLLABORATION_TEMPLATE_VERSION_CONFLICT') setConflict(true);
      else setToast({ kind: 'error', message: t('collaboration.editor.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const sectionLabels = useMemo(() => Object.fromEntries(SECTIONS.map((value) => [value, t(`collaboration.editor.section.${value}`)])) as Record<Section, string>, [t]);

  if (loading || !template) return <div data-testid="template-editor-loading" className="py-14 text-center text-sm text-gray-500">{t('common.loading')}</div>;

  return (
    <div className="mx-auto max-w-6xl min-w-0">
      <SpaceNav spaceId={id} />
      <Link to={`/spaces/${id}/collaboration`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-700"><ArrowLeft size={15} />{t('collaboration.title')}</Link>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-semibold">{creating ? t('collaboration.editor.createTitle') : t('collaboration.editor.title')}</h1><p className="mt-1 text-sm text-gray-600">{t('collaboration.editor.subtitle')}</p></div>
        <button type="button" onClick={() => void save()} disabled={saving || !!issues.length || !template.name.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} />{saving ? t('collaboration.editor.saving') : t('collaboration.editor.save')}</button>
      </div>

      <nav aria-label={t('collaboration.editor.sections')} className="mt-6 flex overflow-x-auto border-b">
        {SECTIONS.map((value) => <button key={value} type="button" onClick={() => setSection(value)} aria-current={section === value ? 'page' : undefined} className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm ${section === value ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-gray-500'}`}>{sectionLabels[value]}</button>)}
      </nav>

      <div className="mt-5 space-y-5">
        <ValidationIssueList issues={issues} title={t('collaboration.editor.issues')} />
        {section === 'overview' ? <OverviewSection template={template} onChange={setTemplate} t={t} /> : null}
        {section === 'inputs' ? <InputsSection definition={template.definition} onChange={updateDefinition} t={t} /> : null}
        {section === 'roles' ? <RolesSection definition={template.definition} onChange={updateDefinition} t={t} /> : null}
        {section === 'flow' ? <FlowStepEditor definition={template.definition} onChange={updateDefinition} labels={flowLabels(t)} /> : null}
        {section === 'outputs' ? <OutputsSection definition={template.definition} onChange={updateDefinition} t={t} /> : null}
      </div>

      {conflict ? <ModalDialog labelledBy="template-conflict-title" onRequestClose={() => setConflict(false)} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 id="template-conflict-title" className="text-lg font-semibold">{t('collaboration.editor.conflictTitle')}</h2><p className="mt-2 text-sm text-gray-600">{t('collaboration.editor.conflictDescription')}</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setConflict(false)} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button><button type="button" onClick={() => { setConflict(false); void load(); }} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm text-white">{t('collaboration.editor.reload')}</button></div></ModalDialog> : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
    </div>
  );
};

const OverviewSection: React.FC<{ template: TemplateDetail; onChange: (template: TemplateDetail) => void; t: (key: string) => string }> = ({ template, onChange, t }) => <section className="space-y-4 rounded-xl border bg-white p-5">
  <label className="block text-sm font-medium">{t('collaboration.templateName')}<input aria-label={t('collaboration.templateName')} value={template.name} onChange={(event) => onChange({ ...template, name: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
  <label className="block text-sm font-medium">{t('common.description')}<textarea value={template.description} onChange={(event) => onChange({ ...template, description: event.target.value })} className="mt-1 min-h-28 w-full rounded-lg border p-3" /></label>
</section>;

const InputsSection: React.FC<{ definition: CollaborationTemplateDefinition; onChange: (definition: CollaborationTemplateDefinition) => void; t: (key: string) => string }> = ({ definition, onChange, t }) => <section className="space-y-3">
  {definition.inputs.map((input, index) => <div key={`${input.key}-${index}`} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[1fr_1fr_auto]">
    <label className="text-sm font-medium">{t('collaboration.editor.inputKey')}<input value={input.key} onChange={(event) => onChange({ ...definition, inputs: definition.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
    <label className="text-sm font-medium">{t('collaboration.editor.inputLabel')}<input value={input.label} onChange={(event) => onChange({ ...definition, inputs: definition.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
    <div className="flex items-end gap-2"><label className="mb-2 text-sm"><input type="checkbox" checked={input.required} onChange={(event) => onChange({ ...definition, inputs: definition.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) })} /> {t('collaboration.editor.required')}</label><button type="button" aria-label={`${t('common.delete')} ${input.label}`} onClick={() => onChange({ ...definition, inputs: definition.inputs.filter((_, itemIndex) => itemIndex !== index) })} className="mb-1 rounded-lg border border-red-200 p-2 text-red-700"><Trash2 size={15} /></button></div>
    <label className="text-sm font-medium sm:col-span-2">{t('common.type')}<select value={input.type} onChange={(event) => onChange({ ...definition, inputs: definition.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as typeof input.type } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="short_text">Short text</option><option value="long_text">Long text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="url">URL</option></select></label>
  </div>)}
  <button type="button" onClick={() => onChange({ ...definition, inputs: [...definition.inputs, { key: `input-${definition.inputs.length + 1}`, label: t('collaboration.editor.newInput'), required: false, type: 'short_text' }] })} className="inline-flex min-h-10 items-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{t('collaboration.editor.addInput')}</button>
</section>;

const RolesSection: React.FC<{ definition: CollaborationTemplateDefinition; onChange: (definition: CollaborationTemplateDefinition) => void; t: (key: string) => string }> = ({ definition, onChange, t }) => <section className="space-y-3">
  {definition.roleSlots.map((role, index) => <div key={`${role.id}-${index}`} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
    <label className="text-sm font-medium">{t('collaboration.editor.roleId')}<input value={role.id} onChange={(event) => onChange({ ...definition, roleSlots: definition.roleSlots.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
    <label className="text-sm font-medium">{t('common.name')}<input value={role.name} onChange={(event) => onChange({ ...definition, roleSlots: definition.roleSlots.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
    <label className="text-sm font-medium sm:col-span-2">{t('common.description')}<input value={role.description} onChange={(event) => onChange({ ...definition, roleSlots: definition.roleSlots.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
    <div className="flex items-center justify-between sm:col-span-2"><label className="text-sm"><input type="checkbox" checked={role.required} onChange={(event) => onChange({ ...definition, roleSlots: definition.roleSlots.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) })} /> {t('collaboration.editor.required')}</label>{definition.roleSlots.length > 1 ? <button type="button" aria-label={`${t('common.delete')} ${role.name}`} onClick={() => onChange({ ...definition, roleSlots: definition.roleSlots.filter((_, itemIndex) => itemIndex !== index) })} className="rounded-lg border border-red-200 p-2 text-red-700"><Trash2 size={15} /></button> : null}</div>
  </div>)}
  <button type="button" onClick={() => onChange({ ...definition, roleSlots: [...definition.roleSlots, { id: `role-${definition.roleSlots.length + 1}`, name: t('collaboration.editor.newRole'), required: true, description: '' }] })} className="inline-flex min-h-10 items-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{t('collaboration.editor.addRole')}</button>
</section>;

const OutputsSection: React.FC<{ definition: CollaborationTemplateDefinition; onChange: (definition: CollaborationTemplateDefinition) => void; t: (key: string) => string }> = ({ definition, onChange, t }) => <section className="rounded-xl border bg-white p-5"><h2 className="font-medium">{t('collaboration.editor.outputsTitle')}</h2><p className="mt-1 text-sm text-gray-500">{t('collaboration.editor.outputsHelp')}</p><ul className="mt-4 space-y-3">{definition.nodes.map((node) => <li key={node.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="min-w-0"><span className="block truncate font-medium">{node.name}</span><span className="text-xs text-gray-500">{node.kind === 'agent_task' ? `${node.output.key} · ${node.output.kind}` : t('collaboration.editor.humanReview')}</span></span><label className="shrink-0 text-sm"><input type="checkbox" checked={definition.terminalNodeIds.includes(node.id)} onChange={(event) => onChange({ ...definition, terminalNodeIds: event.target.checked ? [...new Set([...definition.terminalNodeIds, node.id])] : definition.terminalNodeIds.filter((id) => id !== node.id) })} /> {t('collaboration.editor.terminal')}</label></li>)}</ul></section>;

function newTemplate(spaceId: string, t: (key: string) => string): TemplateDetail {
  return { id: 'new', spaceId, slug: '', name: '', description: '', system: false, version: 1, definition: {
    schemaVersion: 1, inputs: [], roleSlots: [{ id: 'worker', name: t('collaboration.editor.worker'), required: true, description: '' }],
    nodes: [{ kind: 'agent_task', id: 'task-1', name: t('collaboration.editor.firstTask'), roleSlotId: 'worker', objective: t('collaboration.editor.firstTask'), inputKeys: [], upstreamArtifacts: [], output: { key: 'result', kind: 'markdown' }, evidenceRequired: [], humanAcceptance: false, leaseSeconds: 600, maxExecutionSeconds: 3600, retryBudget: 2, repairBudget: 2, skippable: false, todos: [{ id: 'complete', name: t('collaboration.editor.completeTask'), required: true, evidenceKinds: [] }] }],
    dependencies: [], terminalNodeIds: ['task-1'],
  } };
}

function flowLabels(t: (key: string) => string): Record<string, string> {
  const keys = ['newTask', 'completeTask', 'newReview', 'acceptanceCriterion', 'agentTask', 'humanReview', 'addTask', 'addReview', 'moveUp', 'moveDown', 'removeStep', 'stepName', 'role', 'objective', 'outputKey', 'outputKind', 'todoName', 'required', 'removeTodo', 'newTodo', 'addTodo', 'artifactTask', 'revisionTask', 'criteria', 'allowTerminate', 'dependencies', 'dependency', 'dependencyMode', 'removeDependency', 'addDependency'];
  return Object.fromEntries(keys.map((key) => [key, t(`collaboration.editor.${key}`)]));
}
