import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import { BrandMark } from '../../components/BrandMark';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useDirtyNavigationGuard } from '../space-workspace/workspaceNavigation';
import { safeReturnTo } from './safeReturnTo';
import { safeUniHubReturnTo, uniHubEntryHref, uniHubRedirectUrl, uniHubStartHref } from './unihubNavigation';
import { useUniHubStatus } from './useUniHubStatus';

type ReauthMode = 'link' | 'enroll';
type NativeMode = ReauthMode | 'open';

type PendingFlow = { mode: 'sso'; confirmationId: string } | {
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
  continuing: boolean;
  confirmationId: string | null;
  failed: boolean;
  returnTo: string | null;
}

function UniHubFlow({ bound, continuing, confirmationId, failed, returnTo }: UniHubFlowProps) {
  const { token, user, login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ReauthMode | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [pending, setPending] = useState<PendingFlow | null>();
  const cancelled = useRef(false);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const autoAttempted = useRef(false);

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!continuing || departing) return;
    const controller = new AbortController();
    async function loadPreview() {
      let preview: PendingFlow | null = null;
      try {
        if (!confirmationId) {
          setPending(null);
          return;
        }
        const { data } = await api.get<PendingFlow>('/auth/unihub/pending', {
          headers: token ? { Authorization: 'Bearer ' + token } : undefined,
          params: { flow: confirmationId },
          signal: controller.signal,
          timeout: 5000,
        });
        if (localStorage.getItem('token') === token) preview = verifiedPendingFlow(data, token, confirmationId);
      } catch {
        // A failed preview cannot authorize completion.
      }
      if (!controller.signal.aborted) setPending(preview);
    }
    void loadPreview();
    return () => controller.abort();
  }, [continuing, confirmationId, departing, token]);

  useDirtyNavigationGuard(
    !departing && (Boolean(token && continuing) || Boolean(password) || busy),
    t('unihub.leave'),
  );

  const submit = useCallback(async (action: NativeMode | 'finish', password?: string) => {
    if (inFlight.current || cancelled.current) return;
    const finish = action === 'finish';
    if (finish && !pending) return;
    if (localStorage.getItem('token') !== token) {
      setError(t('unihub.sessionChanged'));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const body = finish ? {
        mode: pending?.mode,
        confirmationId: pending?.confirmationId,
        ...(pending?.mode === 'link' ? { centralUserId: pending.centralUserId } : {}),
      } : {
        mode: action,
        ...(action !== 'open' && password ? { password } : {}),
      };
      const { data } = await api.post<FinishResult>(finish ? '/auth/unihub/finish' : '/auth/unihub/native', body, {
        headers: token ? { Authorization: 'Bearer ' + token } : undefined,
      });
      if (!alive.current || localStorage.getItem('token') !== token) return;

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
          login(data.access_token, data.user);
          if (data.user.mustChangePassword) {
            navigate('/change-password', { replace: true });
            return;
          }
        }
        if (redirect) {
          window.location.assign(redirect);
          return;
        }
        navigate(safeUniHubReturnTo(data.returnTo) ?? returnTo ?? '/dashboard', { replace: true });
      });
    } catch (err) {
      if (!alive.current) return;
      if ((err as { response?: { status?: number } })?.response?.status === 401 && action !== 'finish' && action !== 'open') {
        setError(t('unihub.reauthFailed'));
      } else {
        setError(apiErrorMessage(err, t, 'unihub.requestFailed'));
      }
    } finally {
      if (alive.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }, [login, navigate, pending, returnTo, t, token]);

  useEffect(() => {
    if (pending?.mode !== 'sso' || token || autoAttempted.current) return;
    autoAttempted.current = true;
    void submit('finish');
  }, [pending, submit, token]);

  function cancel(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    cancelled.current = true;
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
  const originalLogin = deviceReturn
    ? '/?intent=onboard&returnTo=' + encodeURIComponent(deviceReturn) + '#login'
    : '/?intent=workspace#login';

  const backTo = returnTo ?? (token ? '/dashboard' : '/');
  const visibleError = error || (pending === null ? t('unihub.pendingFailed') : failed ? t('unihub.callbackFailed') : '');

  return (
    <UniHubCard>
      {visibleError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{visibleError}</p>
      ) : null}
      {continuing ? (
        <>
          {pending === undefined ? <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p> : null}
          {pending ? (
            <>
              <p className="text-sm text-gray-600">{t(pending.mode === 'link' ? 'unihub.completeHelp' : 'unihub.signInHelp')}</p>
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
              <button type="button" className={primaryClass} disabled={busy || departing} onClick={() => { void submit('finish'); }}>
                {t(busy || departing ? 'common.loading' : pending.mode === 'link' ? 'unihub.complete' : 'unihub.continue')}
              </button>
            </>
          ) : null}
        </>
      ) : !token ? (
        <div className="flex flex-col gap-3">
          <a className={primaryClass} href={uniHubStartHref(returnTo)}>{t('unihub.signIn')}</a>
          <Link className={secondaryClass} to={originalLogin} state={{ workspaceReturnTo: returnTo }}>{t('unihub.nativeSignIn')}</Link>
        </div>
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
              <button type="button" className={secondaryClass} disabled={busy || departing} onClick={() => choose('enroll')}>{t('unihub.enroll')}</button>
            </>
          ) : null}
          {bound !== false ? (
            <button type="button" className={primaryClass} disabled={busy || departing} onClick={() => { void submit('open'); }}>
              {t(busy || departing ? 'common.loading' : 'unihub.open')}
            </button>
          ) : null}
        </div>
      )}
      {continuing ? (
        !busy && !departing ? (
          <Link to={backTo} replace onClick={cancel} className="block text-sm text-blue-700 hover:underline">{t('common.cancel')}</Link>
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
  // A callback only needs the feature flag. Its preview checks the active session.
  const status = useUniHubStatus(continuing ? null : token);

  if (!status) return <div role="status" className="py-8 text-center text-gray-500">{t('common.loading')}</div>;
  if (!status.enabled) return <Navigate to={returnTo ?? (token ? '/dashboard' : '/')} replace />;
  if (token && user?.mustChangePassword) {
    return <Navigate to="/change-password" replace state={hubEntry ? { uniHubReturnTo: uniHubEntryHref(returnTo) } : undefined} />;
  }
  if (hubEntry && !continuing && !token) {
    return <Navigate to={'/?intent=unihub&returnTo=' + encodeURIComponent(uniHubEntryHref(returnTo)) + '#login'} replace />;
  }

  return <UniHubFlow key={location.key} bound={status.bound} continuing={continuing} confirmationId={confirmationId}
    failed={query.get('error') === 'login'} returnTo={returnTo} />;
}
