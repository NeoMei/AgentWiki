import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';

interface SpaceSettingsModel {
  name: string;
  description?: string;
  approvalPolicy: 'always-review' | 'scoped-auto-publish';
}
interface GraphSettings {
  wikilinkEnabled: boolean;
  similarEnabled: boolean;
  similarThreshold: number;
  llmEnabled: boolean;
}
const AutoGraphCard: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [settings, setSettings] = useState<GraphSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setSettings(null);
    setLoading(true);
    setLoadError(false);
    setMessage('');
    api.get(`/spaces/${spaceId}/graph/settings`)
      .then((response) => {
        if (active) setSettings(response.data);
      })
      .catch(() => {
        if (active) {
          setSettings(null);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [spaceId, reloadKey]);
  const patch = async (update: Partial<GraphSettings>) => {
    if (!settings || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await api.patch(`/spaces/${spaceId}/graph/settings`, { ...settings, ...update });
      setSettings(response.data);
    } catch {
      setMessage(zh ? '保存失败' : 'Save failed');
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const response = await api.post(`/spaces/${spaceId}/graph/refresh`, {});
      const result = response.data;
      setMessage(zh
        ? `刷新完成：链接 +${result.wikilink.created}/-${result.wikilink.removed}，相似 +${result.similar.created}/-${result.similar.removed}，LLM 提案 ${result.llm.proposed}`
        : `Refreshed: links +${result.wikilink.created}/-${result.wikilink.removed}, similar +${result.similar.created}/-${result.similar.removed}, LLM proposals ${result.llm.proposed}`);
    } catch {
      setMessage(zh ? '刷新失败' : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  };
  if (!settings) return (
    <section className='border rounded-[14px] bg-white p-5 mt-5'>
      <h2 className='font-semibold'>{zh ? '知识图谱自动生成' : 'Auto knowledge graph'}</h2>
      {loading ? (
        <p className='mt-3 text-sm text-gray-500'>{zh ? '正在加载图谱设置…' : 'Loading graph settings…'}</p>
      ) : loadError ? (
        <div className='mt-3 flex items-center gap-3'>
          <p className='text-sm text-red-600'>{zh ? '图谱设置加载失败' : 'Failed to load graph settings'}</p>
          <button
            type='button'
            onClick={() => setReloadKey((value) => value + 1)}
            className='text-sm text-blue-600 hover:underline'
          >
            {zh ? '重试' : 'Retry'}
          </button>
        </div>
      ) : null}
    </section>
  );
  const toggles: Array<{ key: keyof GraphSettings; label: string; hint: string }> = [
    { key: 'wikilinkEnabled', label: zh ? 'Wiki 链接提取' : 'Wiki-link extraction', hint: zh ? '从 [[页面]] 链接自动生成关系' : 'Generate relations from [[page]] links' },
    { key: 'similarEnabled', label: zh ? '相似度建议' : 'Similarity suggestions', hint: zh ? '基于向量相似度生成 similar_to 关系' : 'Create similar_to edges from embedding similarity' },
    { key: 'llmEnabled', label: zh ? 'LLM 语义提案' : 'LLM proposals', hint: zh ? '生成待审核的语义关系提案（走审核队列）' : 'Propose semantic relations for review' },
  ];
  return (
    <section className='border rounded-[14px] bg-white p-5 mt-5'>
      <h2 className='font-semibold'>{zh ? '知识图谱自动生成' : 'Auto knowledge graph'}</h2>
      <div className='mt-3 space-y-3'>
        {toggles.map(({ key, label, hint }) => (
          <label key={key} className='flex items-start gap-3'>
            <input
              type='checkbox'
              className='mt-1'
              checked={Boolean(settings[key])}
              disabled={busy || key === 'similarThreshold'}
              onChange={(event) => void patch({ [key]: event.target.checked })}
            />
            <span>
              <span className='block text-sm font-medium'>{label}</span>
              <span className='block text-xs text-gray-500'>{hint}</span>
            </span>
          </label>
        ))}
        <label className='flex items-center gap-3'>
          <span className='text-sm font-medium'>{zh ? '相似度阈值' : 'Similarity threshold'}</span>
          <input
            type='number'
            min={0.5}
            max={1}
            step={0.01}
            value={settings.similarThreshold}
            disabled={busy || !settings.similarEnabled}
            onChange={(event) => setSettings({ ...settings, similarThreshold: Number(event.target.value) })}
            onBlur={() => void patch({ similarThreshold: settings.similarThreshold })}
            className='w-24 border rounded-lg px-2 py-1 text-sm'
          />
        </label>
      </div>
      <div className='mt-4 flex items-center gap-3'>
        <button
          type='button'
          onClick={() => void refresh()}
          disabled={busy}
          className='h-9 px-4 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50'
        >
          {zh ? '立即刷新' : 'Refresh now'}
        </button>
        {message ? <span className='text-xs text-gray-600'>{message}</span> : null}
      </div>
    </section>
  );
};

export const SpaceSettings: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [space, setSpace] = useState<SpaceSettingsModel | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get(`/spaces/${id}`)
      .then((response) => setSpace(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || t('settings.loadFailed')));
  }, [id]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || !space?.name.trim()) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await api.patch(`/spaces/${id}`, {
        name: space.name.trim(),
        description: space.description?.trim() || undefined,
        approvalPolicy: space.approvalPolicy,
      });
      setSaved(true);
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (error && !space) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!space) return <div className="text-center py-12 text-gray-500">{t('settings.loading')}</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <SpaceNav spaceId={id} />
      <Link to={`/spaces/${id}`} className="text-sm text-gray-500 hover:text-blue-600">← {t('common.space')}</Link>
      <h1 className="text-2xl font-semibold mt-3 mb-6">{t('settings.spaceTitle')}</h1>
      <form onSubmit={save} className="space-y-5 border rounded-[14px] bg-white p-5">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="space-name">{t('common.name')}</label>
          <input id="space-name" value={space.name} onChange={(event) => setSpace({ ...space, name: event.target.value })} className="w-full border rounded-lg px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="space-description">{t('common.description')}</label>
          <textarea id="space-description" value={space.description || ''} onChange={(event) => setSpace({ ...space, description: event.target.value })} className="w-full border rounded-lg px-3 py-2" rows={3} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="approval-policy">{t('settings.approval')}</label>
          <p className="text-sm text-gray-500 mb-3">{t('settings.approvalHelp')}</p>
          <select id="approval-policy" value={space.approvalPolicy} onChange={(event) => setSpace({ ...space, approvalPolicy: event.target.value as SpaceSettingsModel['approvalPolicy'] })} className="border rounded-lg px-3 py-2 text-sm">
            <option value="always-review">{t('settings.alwaysReview')}</option>
            <option value="scoped-auto-publish">{t('settings.autoPublish')}</option>
          </select>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? t('common.saving') : t('settings.save')}</button>
          {saved ? <span className="text-sm text-green-600">{t('common.saved')}</span> : null}
        </div>
      </form>
      {id ? <AutoGraphCard spaceId={id} /> : null}
    </div>
  );
};
