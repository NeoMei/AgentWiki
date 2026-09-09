import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

const USER_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

type DeviceStatus = 'pending' | 'approved' | 'authorized' | 'denied' | 'expired';

interface PublicDeviceSession {
  clientType: 'codex' | 'claude' | 'opencode' | 'obsidian';
  purpose: 'full-onboarding' | 'agent-connect' | 'obsidian-connect';
  packageVersion: string;
  status: DeviceStatus;
  expiresAt: string;
}

const CLIENT_LABELS: Record<PublicDeviceSession['clientType'], string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  obsidian: 'Obsidian',
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
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);
  const decisionMessage = decision === 'approved'
    ? (session?.purpose === 'obsidian-connect' ? (zh ? '已授权，请回到 Obsidian 完成连接' : 'Authorized. Return to Obsidian to finish connecting') : (zh ? '已允许此 Agent 接入' : 'This Agent is authorized to connect'))
    : decision === 'denied' ? (zh ? '已拒绝此接入请求' : 'This connection request was denied') : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const requestGeneration = useRef(0);
  const obsidian = session?.purpose === 'obsidian-connect';
  const legacy = session?.purpose === 'full-onboarding';
  const effectiveStatus = session?.status === 'pending' && new Date(session.expiresAt).getTime() <= now ? 'expired' : session?.status;
  useEffect(() => {
    if (!session || session.status !== 'pending') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    requestGeneration.current += 1;
    setSession(null); setDecision(null); setActionError(null); setSubmitting(null);
    setInvalid(!userCode);
    if (!userCode) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    api.get('/onboard/device/session', { params: { userCode } })
      .then(({ data }) => {
        if (!active) return;
        const validPurpose = data?.purpose === 'obsidian-connect'
          ? data.clientType === 'obsidian'
          : ['full-onboarding', 'agent-connect'].includes(data?.purpose) && ['codex', 'claude', 'opencode'].includes(data.clientType);
        if (!validPurpose || !['pending','approved','authorized','denied','expired'].includes(data.status) || !Number.isFinite(Date.parse(data.expiresAt))) { setInvalid(true); return; }
        setNow(Date.now());
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
    if (!userCode || submitting || !session || effectiveStatus !== 'pending') return;
    const generation = requestGeneration.current;
    setSubmitting(decision);
    setActionError(null);
    try {
      const { data } = await api.post('/onboard/device/decision', { userCode, decision });
      if (generation !== requestGeneration.current) return;
      const status = data.status as 'approved' | 'denied';
      if (!['approved','denied'].includes(status)) throw new Error('Invalid decision response');
      setSession((current) => current ? { ...current, status } : current);
      setDecision(status);
    } catch {
      if (generation !== requestGeneration.current) return;
      setActionError(zh ? '操作失败，请刷新后重试。' : 'Action failed. Refresh and try again.');
    } finally {
      if (generation === requestGeneration.current) setSubmitting(null);
    }
  };

  const terminalMessage = effectiveStatus === 'expired'
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
                <h1 className="text-xl font-semibold">{obsidian ? (zh ? '连接 Obsidian' : 'Connect Obsidian') : (zh ? '授权 Agent 接入' : 'Authorize Agent connection')}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-gray-500">
                  <span>AgentWiki</span>
                  <span aria-hidden="true">·</span>
                  <span className="break-all">{window.location.origin}</span>
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
                <p className="mt-2 text-sm text-gray-500">{zh ? '请回到发起连接的客户端获取新的授权链接。' : 'Return to the client that started this connection for a fresh authorization link.'}</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                  <div className="flex items-center gap-3">
                    <Bot size={22} className="text-blue-600" />
                    <div>
                      <div className="font-semibold">{CLIENT_LABELS[session.clientType]}</div>
                      <div className="text-sm text-gray-500">{obsidian ? (zh ? '连接当前账号' : 'Connect your account') : legacy ? (zh ? '完整 Agent 接入' : 'Full Agent onboarding') : (zh ? 'Agent 连接' : 'Agent connection')}</div>
                    </div>
                    <span className="ml-auto rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">{session.packageVersion}</span>
                  </div>
                </div>

                <p className="text-sm leading-6 text-gray-600">
                  {obsidian
                    ? (zh ? '允许后，Obsidian 将连接当前登录账号。回到插件后选择空间和本地文件夹。' : 'Approval connects Obsidian to your signed-in account. Return to the plugin to choose a space and local folder.')
                    : legacy ? (zh ? '允许后，本地 Agent 将继续让你确认 Agent、Space、权限和扫描计划。当前页面不会展示或保存接入密钥。' : 'After approval, your local Agent will ask you to confirm the Agent, Space, permissions, and scan plan. This page never displays or stores connection credentials.')
                    : (zh ? '允许后，本地 Agent 将继续让你确认空间、角色与客户端配置。知识导入可以稍后进行。' : 'After approval, your Agent asks you to confirm the space, role, and client configuration. Knowledge import can wait until later.')}
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
                {effectiveStatus === 'expired' || effectiveStatus === 'denied' ? <p className="text-sm leading-6 text-gray-600">{obsidian ? (zh ? '请回到 Obsidian，重新点击“连接 AgentWiki”。' : 'Return to Obsidian and click “Connect AgentWiki” again.') : legacy ? (zh ? '请回到本地 Agent，按原接入流程重新获取授权链接。' : 'Return to your local Agent and follow the original onboarding flow for a fresh authorization link.') : (zh ? '请让本地 Agent 继续原会话，获取新的浏览器授权链接。' : 'Ask your local Agent to continue the same session for a fresh authorization link.')}</p> : null}
                {(effectiveStatus === 'approved' || effectiveStatus === 'authorized') && !decisionMessage ? <p className="text-sm leading-6 text-gray-600">{obsidian ? (zh ? '请回到 Obsidian，等待连接完成。' : 'Return to Obsidian and wait for the connection to finish.') : legacy ? (zh ? '请回到本地 Agent 继续确认 Agent、Space、权限和扫描计划。' : 'Return to your local Agent to confirm the Agent, Space, permissions, and scan plan.') : (zh ? '请回到本地 Agent 继续确认空间与配置。' : 'Return to your local Agent to continue space and configuration setup.')}</p> : null}
                {actionError ? <p role="alert" className="text-sm text-red-600">{actionError}</p> : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
