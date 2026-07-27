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
    </div>
  );
};
