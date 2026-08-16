import React from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Gem, Globe, Link2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

const COMMUNITY_URL = 'https://community.obsidian.md/plugins/agentwiki-sync';
const GITHUB_URL = 'https://github.com/NeoMei/agentwiki-sync';
const SERVER_URL = 'https://agentwiki.quukk.com/api';

export const ObsidianGuide: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const steps = [
    {
      title: zh ? '从社区插件市场安装（推荐）' : 'Install from the community store (recommended)',
      body: zh
        ? '打开 Obsidian → 设置 → 第三方插件 → 浏览，搜索「AgentWiki Sync」，点击安装并启用。插件上架信息见社区列表页。'
        : 'Open Obsidian → Settings → Community plugins → Browse, search for "AgentWiki Sync", then install and enable it. See the community listing for details.',
    },
    {
      title: zh ? '或从 GitHub 获取' : 'Or get it from GitHub',
      body: zh
        ? 'GitHub 仓库提供源码、Release 和手动安装说明，适合无法访问社区市场或想跟踪开发进度的情况。'
        : 'The GitHub repository provides source code, releases, and manual install instructions when the community store is unavailable or you want to track development.',
    },
    {
      title: zh ? '连接你的 AgentWiki' : 'Connect to your AgentWiki',
      body: zh
        ? '在插件中填入服务器地址，按提示完成设备授权：浏览器登录 AgentWiki 并确认一次性连接码。授权在浏览器完成，插件不保存账号密码。'
        : 'Enter the server URL in the plugin and complete device authorization: sign in to AgentWiki in the browser and confirm the one-time connection code. Authorization happens in the browser; the plugin never stores your password.',
    },
  ];

  return (
    <article className="text-gray-900">
      <header>
        <span className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
          <Gem size={14} /> Obsidian Plugin
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          {zh ? '用 Obsidian 插件同步知识库' : 'Sync your vault with AgentWiki'}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
          {zh
            ? 'AgentWiki Sync 是官方 Obsidian 插件，把 Obsidian 笔记库与 AgentWiki Space 连接起来：在 Obsidian 中写作，把整理好的知识同步给所有 Agent 共用。'
            : 'AgentWiki Sync is the official Obsidian plugin that connects an Obsidian vault to an AgentWiki Space: keep writing in Obsidian and share the curated knowledge with every Agent.'}
        </p>
      </header>

      <section className="mt-10 grid gap-4 sm:grid-cols-2" aria-label={zh ? '插件资源' : 'Plugin resources'}>
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <Globe size={18} className="text-blue-600" />
          </div>
          <h2 className="font-semibold leading-6">{zh ? '社区列表页' : 'Community listing'}</h2>
          <p className="mt-1 break-all text-xs text-gray-500">community.obsidian.md/plugins/agentwiki-sync</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
            {zh ? '在社区查看' : 'View on the forum'} <ExternalLink size={14} />
          </span>
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
            <Download size={18} className="text-gray-700" />
          </div>
          <h2 className="font-semibold leading-6">{zh ? 'GitHub 仓库' : 'GitHub repository'}</h2>
          <p className="mt-1 break-all text-xs text-gray-500">github.com/NeoMei/agentwiki-sync</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
            {zh ? '源码与 Release' : 'Source and releases'} <ExternalLink size={14} />
          </span>
        </a>
      </section>

      <section className="mt-8 space-y-4">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold leading-6">{step.title}</h2>
                <p className="mt-1 text-sm leading-6 text-gray-600">{step.body}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 p-5 sm:flex sm:items-start sm:gap-4">
        <ShieldCheck className="mb-3 shrink-0 text-blue-600 sm:mb-0" size={24} />
        <div>
          <h2 className="font-semibold text-blue-950">{zh ? '同步规则' : 'Sync rules'}</h2>
          <p className="mt-1 text-sm leading-6 text-blue-800">
            {zh
              ? '服务端 Revision 是权威版本：推送前先拉取，检测到冲突时必须人工确认后才会继续；只有你确认的变更会被同步。'
              : 'The server revision is authoritative: pull before push, and detected conflicts always require explicit human confirmation. Only changes you approve are synchronized.'}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50">
            <Link2 size={18} className="text-green-600" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold leading-6">{zh ? '服务器地址' : 'Server URL'}</h2>
            <p className="mt-1 text-sm text-gray-600">{zh ? '插件连接当前官方部署时使用：' : 'Use the following URL for the current official deployment:'}</p>
            <code className="mt-2 inline-block max-w-full overflow-x-auto rounded-lg bg-gray-950 px-3 py-2 text-sm text-green-300">{SERVER_URL}</code>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
            <ShieldCheck size={18} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold leading-6">{zh ? '管理已连接的设备' : 'Manage connected devices'}</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              {zh
                ? '连接后可以在网页端的「集成」页面查看和管理 Obsidian 设备，包括撤销不再使用的设备凭据。'
                : 'After connecting, manage Obsidian devices (including revoking unused device credentials) on the Integrations page of this site.'}
            </p>
            <Link
              to="/settings/integrations"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {zh ? '打开集成管理' : 'Open integrations'}
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
};
