import React, { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

const USER_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

type DeviceStatus = 'pending' | 'approved' | 'authorized' | 'denied' | 'expired';

interface PublicDeviceSession {
  clientType: 'codex' | 'claude' | 'opencode';
  purpose: 'full-onboarding';
  packageVersion: string;
  status: DeviceStatus;
  expiresAt: string;
}

const CLIENT_LABELS: Record<PublicDeviceSession['clientType'], string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
};

export const OnboardDevicePage: React.FC = () => {
  const { token } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [searchParams] = useSearchParams();
  const rawUserCode = searchParams.get('user_code');
  const userCode = rawUserCode && USER_CODE_PATTERN.test(rawUserCode) ? rawUserCode : null;
  const [session, setSession] = useState<PublicDeviceSession | null>(null);
  const [loading, setLoading] = useState(Boolean(userCode));
  const [invalid, setInvalid] = useState(!userCode);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!userCode) return;
    let active = true;
    setLoading(true);
    api.get('/onboard/device/session', { params: { userCode } })
      .then(({ data }) => {
        if (!active) return;
        setSession(data as PublicDeviceSession);
        setInvalid(false);
      })
      .catch(() => {
        if (active) setInvalid(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [userCode]);

  const signInHref = useMemo(() => {
    if (!userCode) return '/?intent=onboard#login';
    const returnTo = `/onboard/device?user_code=${encodeURIComponent(userCode)}`;
    return `/?intent=onboard&returnTo=${encodeURIComponent(returnTo)}#login`;
  }, [userCode]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!userCode || submitting || !session || session.status !== 'pending') return;
    setSubmitting(decision);
    setActionError(null);
    try {
      const { data } = await api.post('/onboard/device/decision', { userCode, decision });
      const status = data.status as 'approved' | 'denied';
      setSession((current) => current ? { ...current, status } : current);
      setDecisionMessage(status === 'approved'
        ? (zh ? '已允许此 Agent 接入' : 'This Agent is authorized to connect')
        : (zh ? '已拒绝此接入请求' : 'This connection request was denied'));
    } catch {
      setActionError(zh ? '操作失败，请刷新后重试。' : 'Action failed. Refresh and try again.');
    } finally {
      setSubmitting(null);
    }
  };

  const terminalMessage = session?.status === 'expired'
    ? (zh ? '授权请求已过期' : 'The authorization request has expired')
    : session?.status === 'denied'
      ? (zh ? '此接入请求已被拒绝' : 'This connection request was denied')
      : session?.status === 'approved' || session?.status === 'authorized'
        ? (zh ? '此接入请求已完成决定' : 'This connection request has already been decided')
        : null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <GlobalNavigation density="public" />
      <main className="mx-auto max-w-xl px-4 py-12 sm:py-20">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-6 sm:px-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h1 className="text-xl font-semibold">{zh ? '授权 Agent 接入' : 'Authorize Agent connection'}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-gray-500">
                  <span>AgentWiki</span>
                  <span aria-hidden="true">·</span>
                  <span>https://agentwiki.quukk.com</span>
                </div>
              </div>
            </div>
          </header>

          <div className="px-6 py-7 sm:px-8">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                <Clock3 className="animate-pulse" size={18} />
                {zh ? '正在验证授权请求…' : 'Validating authorization request…'}
              </div>
            ) : invalid || !session ? (
              <div className="py-8 text-center">
                <XCircle className="mx-auto mb-3 text-red-500" size={34} />
                <h2 className="font-semibold">{userCode ? (zh ? '授权链接无效或已失效' : 'Authorization link is invalid or expired') : (zh ? '授权链接无效' : 'Invalid authorization link')}</h2>
                <p className="mt-2 text-sm text-gray-500">{zh ? '请回到本地 Agent，重新开始接入。' : 'Return to your local Agent and restart onboarding.'}</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                  <div className="flex items-center gap-3">
                    <Bot size={22} className="text-blue-600" />
                    <div>
                      <div className="font-semibold">{CLIENT_LABELS[session.clientType]}</div>
                      <div className="text-sm text-gray-500">{zh ? '完整 Agent 接入' : 'Full Agent onboarding'}</div>
                    </div>
                    <span className="ml-auto rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">{session.packageVersion}</span>
                  </div>
                </div>

                <p className="text-sm leading-6 text-gray-600">
                  {zh
                    ? '允许后，本地 Agent 将继续让你确认 Agent、Space、权限和扫描计划。当前页面不会展示或保存接入密钥。'
                    : 'After approval, your local Agent will ask you to confirm the Agent, Space, permissions, and scan plan. This page never displays or stores connection credentials.'}
                </p>

                {decisionMessage ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
                    <CheckCircle2 size={18} /> {decisionMessage}
                  </div>
                ) : terminalMessage ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-700">{terminalMessage}</div>
                ) : !token ? (
                  <Link to={signInHref} className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">
                    {zh ? '登录或注册后授权' : 'Sign in or register to authorize'}
                  </Link>
                ) : (
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => decide('deny')}
                      className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {zh ? '拒绝' : 'Deny'}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => decide('approve')}
                      className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting === 'approve' ? (zh ? '授权中…' : 'Authorizing…') : (zh ? '允许接入' : 'Authorize connection')}
                    </button>
                  </div>
                )}
                {actionError ? <p role="alert" className="text-sm text-red-600">{actionError}</p> : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
