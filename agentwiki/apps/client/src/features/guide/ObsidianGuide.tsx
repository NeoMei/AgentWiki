import React from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Gem, Globe, Link2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { ObsidianConnectionPanel } from './ObsidianConnectionPanel';

const GITHUB_RELEASE_URL = 'https://github.com/NeoMei/agentwiki-sync/releases/latest';
const SERVER_URL = 'https://agentwiki.quukk.com/api';

export const ObsidianGuide: React.FC = () => {
  const { language } = useLanguage();
  const { token } = useAuth();
  const zh = language === 'zh-CN';

  const steps = [
    {
      title: zh ? '社区市场审核中' : 'Community listing under review',
      body: zh
        ? '官方上架申请已经提交。审核通过前，在 Obsidian 社区插件中搜索不到 AgentWiki Sync，这是当前预期状态。'
        : 'The official listing has been submitted. Until approval, AgentWiki Sync is not expected to appear in Community Plugins search.',
    },
    {
      title: zh ? '从 GitHub Release 手动安装' : 'Install manually from GitHub Releases',
      body: zh
        ? '下载 main.js、manifest.json、styles.css，放入 Vault 的 .obsidian/plugins/agentwiki-sync/，重启 Obsidian 后启用插件。'
        : 'Download main.js, manifest.json, and styles.css into .obsidian/plugins/agentwiki-sync/ in your vault, restart Obsidian, then enable the plugin.',
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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <Globe size={18} className="text-blue-600" />
          </div>
          <h2 className="font-semibold leading-6">{zh ? '官方上架申请已提交' : 'Official listing submitted'}</h2>
          <p className="mt-2 text-sm text-amber-800">{zh ? '审核通过前请使用 GitHub Release 手动安装。' : 'Use the GitHub Release for manual installation until approval.'}</p>
        </div>
        <a
          href={GITHUB_RELEASE_URL}
          aria-label={zh ? '下载最新 Release' : 'Download latest Release'}
          target="_blank"
          rel="noreferrer"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
            <Download size={18} className="text-gray-700" />
          </div>
          <h2 className="font-semibold leading-6">{zh ? '最新 GitHub Release' : 'Latest GitHub Release'}</h2>
          <p className="mt-1 break-all text-xs text-gray-500">github.com/NeoMei/agentwiki-sync/releases/latest</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
            {zh ? '下载最新 Release' : 'Download latest Release'} <ExternalLink size={14} />
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

      {token ? <ObsidianConnectionPanel /> : (
        <section className="mt-8 rounded-2xl border border-purple-200 bg-purple-50 p-5 sm:p-6">
          <h2 className="font-semibold text-purple-950">{zh ? '登录后生成连接码' : 'Sign in to generate a connection code'}</h2>
          <p className="mt-1 text-sm leading-6 text-purple-800">
            {zh ? '安装好插件后，登录 AgentWiki，即可在本页生成一次性连接码并管理已连接设备。' : 'After installing the plugin, sign in to generate a one-time code and manage connected devices on this page.'}
          </p>
          <Link to="/?intent=workspace&returnTo=%2Fguide%2Fobsidian#login" className="mt-3 inline-flex rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
            {zh ? '登录 AgentWiki' : 'Sign in to AgentWiki'}
          </Link>
        </section>
      )}
    </article>
  );
};
