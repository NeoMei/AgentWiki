import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api, { authSessionKey, readAuthSession } from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import { BrandMark } from '../../components/BrandMark';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useDirtyNavigationGuard } from '../space-workspace/workspaceNavigation';
import { safeReturnTo } from './safeReturnTo';
import { safeUniHubReturnTo, uniHubEntryHref, uniHubOriginalLoginHref, uniHubRedirectUrl, uniHubStartHref } from './unihubNavigation';
import { useUniHubStatus } from './useUniHubStatus';

type ReauthMode = 'link' | 'enroll';
type NativeMode = ReauthMode | 'open' | 'auto';
type CallbackSession = 'checking' | 'current' | 'changed';

const callbackSessionKey = (id: string) => 'agentwiki.unihub.callback.' + id;
const recordingSessions = new Map<string, Promise<void>>();

function invalidateCallbackSession(key: string) {
  try {
    sessionStorage.setItem(key, 'changed');
  } catch {
    // A callback with unavailable tab storage fails its session check.
  }
}

async function sessionFingerprint(token: string | null): Promise<string> {
  if (token === null) return 'signed-out';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function matchesCallbackSession(key: string, token: string | null) {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved === 'changed') return false;
    // Claim the callback before hashing so a remount cannot choose a new owner.
    if (saved === null) sessionStorage.setItem(key, 'recording');
    const fingerprint = sessionFingerprint(token);
    if (saved === null) {
      recordingSessions.set(key, fingerprint.then((value) => {
        if (sessionStorage.getItem(key) === 'recording') sessionStorage.setItem(key, value);
      }).finally(() => recordingSessions.delete(key)));
    }
    const [current] = await Promise.all([fingerprint, recordingSessions.get(key)]);
    if (sessionStorage.getItem(key) === current) return true;
  } catch {
    // A missing fingerprint or interrupted claim requires a fresh callback.
  }
  invalidateCallbackSession(key);
  return false;
}

function useCallbackSession(confirmationId: string | null, token: string | null): CallbackSession {
  const [result, setResult] = useState<{ id: string; token: string | null; status: CallbackSession }>();
  useLayoutEffect(() => {
    if (confirmationId === null) return;
    const id = confirmationId;
    const key = callbackSessionKey(id);
    let active = true;
    function sessionChanged() {
      if (readAuthSession().token === token) return false;
      invalidateCallbackSession(key);
      setResult({ id, token, status: 'changed' });
      return true;
    }
    function checkStorage(event: StorageEvent) {
      if (event.storageArea === localStorage && (event.key === authSessionKey || event.key === 'token' || event.key === null)) {
        sessionChanged();
      }
    }
    window.addEventListener('storage', checkStorage);
    if (!sessionChanged()) {
      void matchesCallbackSession(key, token).then((matches) => {
        if (active && !sessionChanged()) setResult({ id, token, status: matches ? 'current' : 'changed' });
      });
    }
    return () => {
      active = false;
      window.removeEventListener('storage', checkStorage);
    };
  }, [confirmationId, token]);

  if (!confirmationId) return 'current';
  return result?.id === confirmationId && result.token === token ? result.status : 'checking';
}

type PendingFlow = { mode: 'sso'; confirmationId: string; sameUser?: boolean; returnTo?: string } | {
  mode: 'link';
  confirmationId: string;
  localEmail: string;
  centralUserId: string;
  displayName: string;
  maskedEmail: string;
};

function verifiedPendingFlow(data: PendingFlow | undefined, token: string | null, confirmationId: string): PendingFlow | null {
  if (data?.confirmationId !== confirmationId) return null;
  if (data?.mode === 'sso') return data;
  if (data?.mode === 'link' && token && typeof data.displayName === 'string'
    && [data.localEmail, data.centralUserId, data.maskedEmail].every((value) => typeof value === 'string' && value.trim())) {
    return data;
  }
  return null;
}

interface FinishResult {
  access_token?: string;
  user?: { id: string; mustChangePassword?: boolean };
  redirectUrl?: string;
  returnTo?: string;
}

const primaryClass = 'inline-flex justify-center rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50';
const secondaryClass = 'inline-flex justify-center rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50';

function UniHubCard({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-gray-50 px-4 py-16">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <h1 className="text-2xl font-bold text-gray-900">UniHub</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

interface UniHubFlowProps {
  bound?: boolean;
  nativeEntry: boolean;
  workspaceEntry: boolean;
  workspaceChoice: boolean;
  workspaceSignIn: boolean;
  continuing: boolean;
  confirmationId: string | null;
  callbackSession: CallbackSession;
  failed: boolean;
  returnTo: string | null;
}

function UniHubFlow({ bound, nativeEntry, workspaceEntry, workspaceChoice, workspaceSignIn, continuing, confirmationId, callbackSession, failed, returnTo }: UniHubFlowProps) {
  const { token, user, login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ReauthMode | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const [linkRequired, setLinkRequired] = useState(false);
  const autoEntry = nativeEntry && !continuing && Boolean(token);
  const [preview, setPreview] = useState<{ token: string | null; flow: PendingFlow | null }>();
  const pending = callbackSession === 'current' && preview?.token === token ? preview.flow : undefined;
  const switchRequired = pending?.mode === 'sso' && Boolean(token) && pending.sameUser !== true;
  const autoFinish = pending?.mode === 'sso' && !switchRequired;
  const destination = (pending?.mode === 'sso' ? safeUniHubReturnTo(pending.returnTo) : null) ?? returnTo;
  const cancelled = useRef(false);
  const alive = useRef(false);
  const submission = useRef<AbortController | null>(null);
  const autoAttempted = useRef(false);

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (continuing) submission.current?.abort();
    };
  }, [continuing]);

  useLayoutEffect(() => {
    if (callbackSession !== 'current') submission.current?.abort();
  }, [callbackSession]);

  useEffect(() => {
    if (!continuing || departing || callbackSession !== 'current') return;
    const controller = new AbortController();
    async function loadPreview() {
      if (!confirmationId) {
        setPreview({ token, flow: null });
        return;
      }
      let flow: PendingFlow | null = null;
      try {
        const { data } = await api.get<PendingFlow>('/auth/unihub/pending', {
          authSessionToken: token,
          params: { flow: confirmationId },
          signal: controller.signal,
          timeout: 5000,
        });
        if (readAuthSession().token === token) flow = verifiedPendingFlow(data, token, confirmationId);
      } catch {
        // A failed preview cannot authorize completion.
      }
      if (!controller.signal.aborted) setPreview({ token, flow });
    }
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadPreview();
    });
    return () => controller.abort();
  }, [callbackSession, continuing, confirmationId, departing, token]);

  useDirtyNavigationGuard(
    !departing && (Boolean(token && continuing) || Boolean(password) || busy),
    t('unihub.leave'),
  );

  const submit = useCallback(async (action: NativeMode | 'finish' | 'switch', password?: string) => {
    if (submission.current || cancelled.current) return;
    const finish = action === 'finish' || action === 'switch';
    if (finish && (!pending || finishFailed || (action === 'switch') !== switchRequired)) return;
    function sessionChanged() {
      if (action === 'auto') setAutoFailed(true);
      if (finish) {
        if (confirmationId) invalidateCallbackSession(callbackSessionKey(confirmationId));
        setFinishFailed(true);
      }
      setError(t('unihub.sessionChanged'));
    }
    if (readAuthSession().token !== token) {
      sessionChanged();
      return;
    }
    const controller = new AbortController();
    submission.current = controller;
    setBusy(true);
    setError('');
    try {
      const body = finish ? {
        mode: pending?.mode,
        confirmationId: pending?.confirmationId,
        ...(pending?.mode === 'link' ? { centralUserId: pending.centralUserId } : {}),
        ...(pending?.mode === 'sso' && pending.sameUser === true ? { requireSameUser: true } : {}),
        ...(action === 'switch' ? { confirmAccountSwitch: true } : {}),
      } : {
        mode: action,
        ...(workspaceEntry ? { workspaceReturnTo: returnTo ?? '/dashboard' } : {}),
        ...(action !== 'open' && password ? { password } : {}),
      };
      const { data } = await api.post<FinishResult>(finish ? '/auth/unihub/finish' : '/auth/unihub/native', body, {
        authSessionToken: token,
        signal: controller.signal,
        timeout: 8000,
      });
      if (!alive.current || cancelled.current || controller.signal.aborted) return;
      if (readAuthSession().token !== token) {
        sessionChanged();
        return;
      }

      const redirect = uniHubRedirectUrl(data.redirectUrl);
      if (data.redirectUrl !== undefined && !redirect) throw new Error('Invalid UniHub redirect');
      if (!finish && !redirect) throw new Error('Missing UniHub redirect');
      if (finish && !token && !redirect && !(data.access_token && data.user?.id)) {
        throw new Error('Missing AgentWiki session');
      }

      // Remove the confirmation guard before following the confirmed handoff.
      flushSync(() => setDeparting(true));
      startTransition(() => {
        if (finish && data.access_token && data.user?.id) {
          if (!login(data.access_token, data.user)) {
            setDeparting(false);
            sessionChanged();
            return;
          }
          if (data.user.mustChangePassword) {
            navigate('/change-password', { replace: true });
            return;
          }
        }
        if (redirect) {
          window.location.assign(redirect);
          return;
        }
        navigate(safeUniHubReturnTo(data.returnTo) ?? destination ?? '/dashboard', { replace: true });
      });
    } catch (err) {
      if (!alive.current || cancelled.current || controller.signal.aborted) return;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (action === 'auto') setAutoFailed(true);
      // A failed finish may already have consumed the browser flow.
      if (finish) setFinishFailed(true);
      if (action === 'auto' && status === 409 && bound !== true) {
        setLinkRequired(true);
        setError(t('unihub.linkRequired'));
      } else if (status === 401 && action !== 'finish' && action !== 'open') {
        setError(t('unihub.reauthFailed'));
      } else {
        setError(apiErrorMessage(err, t, 'unihub.requestFailed'));
      }
    } finally {
      submission.current = null;
      if (alive.current && !cancelled.current) setBusy(false);
    }
  }, [bound, confirmationId, destination, finishFailed, login, navigate, pending, returnTo, switchRequired, t, token, workspaceEntry]);

  useEffect(() => {
    if (autoAttempted.current) return;
    if (autoEntry || autoFinish) {
      autoAttempted.current = true;
      void submit(autoEntry ? 'auto' : 'finish');
    }
  }, [autoEntry, autoFinish, submit]);

  function leave(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    cancelled.current = true;
    submission.current?.abort();
    flushSync(() => setDeparting(true));
  }

  function choose(next: ReauthMode | null) {
    setMode(next);
    setPassword('');
    setError('');
  }

  function submitReauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode) void submit(mode, password);
  }

  const deviceReturn = safeReturnTo(returnTo);
  const originalLogin = workspaceChoice ? (token ? uniHubEntryHref(returnTo, true) : uniHubOriginalLoginHref(returnTo, true)) : deviceReturn
    ? '/?intent=onboard&returnTo=' + encodeURIComponent(deviceReturn) + '#login'
    : '/?intent=workspace#login';

  const backTo = destination ?? (token ? '/dashboard' : '/');
  const callbackChanged = callbackSession === 'changed';
  const restartSignIn = callbackChanged || (!continuing && failed && returnTo !== null) || pending === null || (finishFailed && pending?.mode === 'sso');
  const showCallback = continuing || restartSignIn;
  const visibleError = callbackChanged ? t('unihub.sessionChanged')
    : error || (pending === null ? t('unihub.pendingFailed') : failed ? t('unihub.callbackFailed') : '');

  return (
    <UniHubCard>
      {visibleError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{visibleError}</p>
      ) : null}
      {showCallback ? (
        <>
          {continuing && !callbackChanged && !finishFailed && (pending === undefined || autoFinish) ? (
            <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p>
          ) : null}
          {pending && !finishFailed && !autoFinish ? (
            <>
              <p className="text-sm text-gray-600">{t(pending.mode === 'link' ? 'unihub.completeHelp' : 'unihub.switchAccountHelp')}</p>
              {pending.mode === 'link' ? (
                <dl className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div>
                    <dt className="font-medium text-gray-600">{t('unihub.localAccount')}</dt>
                    <dd className="break-words text-gray-900">{pending.localEmail}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-600">{t('unihub.centralAccount')}</dt>
                    {pending.displayName ? <dd className="break-words text-gray-900">{pending.displayName}</dd> : null}
                    <dd className="break-words text-gray-900">{pending.maskedEmail}</dd>
                  </div>
                </dl>
              ) : null}
              <button type="button" className={primaryClass} disabled={busy || departing}
                onClick={() => { void submit(pending.mode === 'link' ? 'finish' : 'switch'); }}>
                {t(busy || departing ? 'common.loading' : pending.mode === 'link' ? 'unihub.complete' : 'unihub.switchAccount')}
              </button>
            </>
          ) : null}
          {restartSignIn ? (
            <a className={primaryClass} href={uniHubStartHref(destination, workspaceSignIn ? 'workspace' : undefined)} onClick={leave}>{t('unihub.restartSignIn')}</a>
          ) : finishFailed && pending?.mode === 'link' ? (
            <Link className={primaryClass} replace onClick={leave}
              to={destination ? '/unihub?returnTo=' + encodeURIComponent(destination) : '/unihub'}>
              {t('unihub.restartConnection')}
            </Link>
          ) : null}
        </>
      ) : !token || workspaceChoice ? (
        <div className="flex flex-col gap-3">
          <a className={primaryClass} href={uniHubStartHref(returnTo, workspaceChoice ? 'interactive' : undefined)}>{t('unihub.signIn')}</a>
          <Link className={secondaryClass} to={originalLogin} state={{ workspaceReturnTo: returnTo }}>{t('unihub.nativeSignIn')}</Link>
          {workspaceChoice ? <p className="text-sm text-gray-600">{t('unihub.migrateHelp')}</p> : null}
        </div>
      ) : autoEntry && !autoFailed ? (
        <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p>
      ) : mode ? (
        <form className="space-y-4" onSubmit={submitReauth}>
          <h2 className="font-semibold text-gray-900">{t('unihub.' + mode)}</h2>
          <div>
            <label htmlFor="unihub-password" className="mb-1 block text-sm font-medium">{t('unihub.password')}</label>
            <input id="unihub-password" type="password" autoComplete="current-password" value={password}
              disabled={busy || departing} onChange={(event) => setPassword(event.target.value)}
              aria-describedby="unihub-password-help" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            <p id="unihub-password-help" className="mt-1 text-sm text-gray-500">{t('unihub.passwordHelp')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryClass} disabled={busy || departing}>{t(busy || departing ? 'common.loading' : 'unihub.continue')}</button>
            <button type="button" className={secondaryClass} disabled={busy || departing} onClick={() => choose(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {bound !== true && user?.authSource !== 'unihub' ? (
            <>
              <button type="button" className={secondaryClass} disabled={busy || departing} onClick={() => choose('link')}>{t('unihub.link')}</button>
              {!linkRequired ? <button type="button" className={secondaryClass} disabled={busy || departing} onClick={() => choose('enroll')}>{t('unihub.enroll')}</button> : null}
            </>
          ) : null}
          {bound !== false && !linkRequired ? (
            <button type="button" className={primaryClass} disabled={busy || departing} onClick={() => { void submit('open'); }}>
              {t(busy || departing ? 'common.loading' : 'unihub.open')}
            </button>
          ) : null}
        </div>
      )}
      {showCallback ? (
        !departing ? (
          <Link to={backTo} replace onClick={leave} className="block text-sm text-blue-700 hover:underline">{t('common.cancel')}</Link>
        ) : null
      ) : token ? (
        <Link to={backTo} className="inline-block text-sm text-blue-700 hover:underline">{t('unihub.backToWorkspace')}</Link>
      ) : null}
    </UniHubCard>
  );
}

export default function UniHubPage() {
  const { token, user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const returnTo = safeUniHubReturnTo(query.get('returnTo'));
  const continuing = query.get('continue') === '1';
  const flow = query.get('flow');
  const confirmationId = flow && /^[a-f0-9]{64}$/.test(flow) ? flow : null;
  const hubEntry = query.get('entry') === 'hub';
  const requestedWorkspaceEntry = query.get('entry') === 'workspace';
  const callbackSession = useCallbackSession(continuing ? confirmationId : null, token);
  // A callback only needs the feature flag. Its preview checks the active session.
  const status = useUniHubStatus(continuing ? null : token, callbackSession !== 'changed');

  if (callbackSession !== 'changed') {
    if (!status) return <div role="status" className="py-8 text-center text-gray-500">{t('common.loading')}</div>;
    if (!status.enabled) return <Navigate to={returnTo ?? (token ? '/dashboard' : '/')} replace />;
  }
  const workspaceEntry = requestedWorkspaceEntry && status?.defaultLogin === true;
  const workspaceChoice = query.get('error') === 'workspace' && status?.defaultLogin === true;
  const workspaceSignIn = query.get('mode') === 'workspace' && status?.defaultLogin === true;
  const nativeEntry = hubEntry || workspaceEntry;
  if (token && user?.mustChangePassword && callbackSession === 'current') {
    return <Navigate to="/change-password" replace state={nativeEntry ? { passwordUserId: user.id, uniHubReturnTo: uniHubEntryHref(returnTo, workspaceEntry) } : undefined} />;
  }
  if (requestedWorkspaceEntry && !continuing && token && (!workspaceEntry || user?.authSource === 'unihub')) {
    return <Navigate to={returnTo ?? '/dashboard'} replace />;
  }
  if (nativeEntry && !continuing && !token) {
    return <Navigate to={uniHubOriginalLoginHref(returnTo, workspaceEntry)} replace />;
  }

  return <UniHubFlow key={location.key} bound={status?.bound} nativeEntry={nativeEntry} workspaceEntry={workspaceEntry}
    workspaceChoice={workspaceChoice} workspaceSignIn={workspaceSignIn} continuing={continuing} confirmationId={confirmationId}
    callbackSession={callbackSession} failed={query.get('error') === 'login'} returnTo={returnTo} />;
}
