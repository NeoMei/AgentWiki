import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { listFolderAncestry } from '../content-tree/contentTreeApi';
import { folderIdFromSearch, spaceFolderHref } from '../space-workspace/workspaceNavigation';
import { NewPageDialog, type NewPageCreationTarget } from './NewPageDialog';

export function NewContentPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const folderId = folderIdFromSearch(location.search);
  const fromCollaboration = new URLSearchParams(location.search).get('from') === 'collaboration';
  return <NewContentPageSession key={JSON.stringify([id, folderId, fromCollaboration])}
    spaceId={id ?? ''} folderId={folderId} fromCollaboration={fromCollaboration} />;
}

function NewContentPageSession({ spaceId, folderId, fromCollaboration }: {
  spaceId: string; folderId: string | null; fromCollaboration: boolean;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [destination, setDestination] = useState<{ identity: string; label: string; error?: string } | null>(null);
  const identity = JSON.stringify([spaceId, folderId, user?.id, user?.platformRole]);
  const current = destination?.identity === identity ? destination : null;
  const returnHref = fromCollaboration ? `/spaces/${encodeURIComponent(spaceId)}/collaboration` : spaceFolderHref(spaceId, folderId);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data: space } = await api.get(`/spaces/${encodeURIComponent(spaceId)}`, { signal: controller.signal });
        const role = space.members?.find((member: { userId: string }) => member.userId === user?.id)?.role;
        if (user?.platformRole !== 'super_admin' && !['owner', 'admin', 'editor'].includes(role)) {
          if (!controller.signal.aborted) setDestination({ identity, label: '', error: 'creation.denied' });
          return;
        }
        let label = space.name;
        if (folderId) {
          const ancestry = await listFolderAncestry(spaceId, folderId, controller.signal);
          if (!ancestry.ancestorIds.length) {
            if (!controller.signal.aborted) setDestination({ identity, label: '', error: 'creation.folderMissing' });
            return;
          }
          label = [space.name, ...ancestry.ancestorIds.map((id) => ancestry.folders.get(id)!.name)].join(' / ');
        }
        if (!controller.signal.aborted) setDestination({ identity, label });
      } catch {
        if (!controller.signal.aborted) setDestination({ identity, label: '', error: 'settings.loadFailed' });
      }
    })();
    return () => controller.abort();
  }, [spaceId, folderId, user?.id, user?.platformRole, identity]);

  const onCreated = (target: string | NewPageCreationTarget) => {
    if (typeof target === 'string') navigate(`/pages/${encodeURIComponent(target)}/edit`, { replace: true });
    else if (target.rootFolderId) navigate(spaceFolderHref(spaceId, target.rootFolderId), { replace: true });
    else if (target.firstPageId) navigate(`/pages/${encodeURIComponent(target.firstPageId)}/edit`, { replace: true });
    else if (target.runId) navigate(`/spaces/${encodeURIComponent(spaceId)}/collaboration/runs/${encodeURIComponent(target.runId)}`, { replace: true });
    else navigate(spaceFolderHref(spaceId, folderId), { replace: true });
  };

  if (!current) return <p role="status" className="p-6 text-sm text-gray-500">{t('common.loading')}</p>;
  if (current.error) return <div className="space-y-4 p-6"><p role="alert">{t(current.error)}</p>
    <button type="button" className="min-h-10 rounded-lg border px-4 text-sm" onClick={() => navigate(returnHref)}>{t('creation.return')}</button></div>;
  return <NewPageDialog presentation="page" initialKind={fromCollaboration ? 'page_group' : 'blank'}
    spaceId={spaceId} folderId={folderId} targetLocation={current.label}
    onClose={() => navigate(returnHref)} onCreated={onCreated} />;
}
