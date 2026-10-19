import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTemplateEntryLanguage as useLanguage } from './useTemplateEntryLanguage';
import { listFolderAncestry } from '../content-tree/contentTreeApi';
import { folderIdFromSearch, spaceFolderHref } from '../space-workspace/workspaceNavigation';
import { NewPageDialog, type NewPageDialogProps, type NewPageCreationTarget } from './NewPageDialog';

export function NewContentPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const folderId = folderIdFromSearch(location.search);
  const params = new URLSearchParams(location.search);
  const fromCollaboration = params.get('from') === 'collaboration';
  const kind = params.get('kind');
  const scope = params.get('scope');
  const initialScope = scope === 'space' || scope === 'system' ? scope : 'all';
  const initialKind = kind === 'single_page' || kind === 'page_group' ? kind
    : scope === 'space' ? 'custom' : fromCollaboration ? 'page_group' : 'blank';
  const initialTemplateId = params.get('template') || undefined;
  return <NewContentPageSession key={JSON.stringify([id, folderId, fromCollaboration, initialKind, initialScope, initialTemplateId])}
    spaceId={id ?? ''} folderId={folderId} fromCollaboration={fromCollaboration}
    initialKind={initialKind} initialScope={initialScope} initialTemplateId={initialTemplateId} />;
}

function NewContentPageSession({ spaceId, folderId, fromCollaboration, ...initial }: {
  spaceId: string; folderId: string | null; fromCollaboration: boolean;
} & Pick<NewPageDialogProps, 'initialKind' | 'initialScope' | 'initialTemplateId'>) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [destination, setDestination] = useState<{ identity: string; label: string; canManage?: boolean; error?: string } | null>(null);
  const identity = JSON.stringify([spaceId, folderId, user?.id, user?.platformRole]);
  const current = destination?.identity === identity ? destination : null;
  const returnHref = fromCollaboration ? `/spaces/${encodeURIComponent(spaceId)}/collaboration` : spaceFolderHref(spaceId, folderId);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data: space } = await api.get(`/spaces/${encodeURIComponent(spaceId)}`, { signal: controller.signal });
        const role = space.members?.find((member: { userId: string }) => member.userId === user?.id)?.role;
        if (!['owner', 'admin', 'editor'].includes(role)) {
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
        if (!controller.signal.aborted) setDestination({ identity, label, canManage: role === 'owner' || role === 'admin' });
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

  if (!current) return <p role="status" className="template-route-state">{t('common.loading')}</p>;
  if (current.error) return <div className="template-route-state template-creation"><p role="alert">{t(current.error)}</p>
    <button type="button" className="template-button" onClick={() => navigate(returnHref)}>{t('creation.return')}</button></div>;
  return <NewPageDialog presentation="page" {...initial} canManageTemplates={current.canManage}
    spaceId={spaceId} folderId={folderId} targetLocation={current.label}
    onClose={() => navigate(returnHref)} onCreated={onCreated} />;
}
