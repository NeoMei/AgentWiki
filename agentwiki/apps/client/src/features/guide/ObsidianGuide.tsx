import React from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Gem, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { ObsidianConnectionPanel } from './ObsidianConnectionPanel';

const GITHUB_RELEASE_URL = 'https://github.com/NeoMei/agentwiki-sync/releases/latest';
const OBSIDIAN_PLUGIN_URL = 'obsidian://show-plugin?id=agentwiki-sync';

export const ObsidianGuide: React.FC = () => {
  const { language } = useLanguage();
  const { token } = useAuth();
  const zh = language === 'zh-CN';
  const steps = zh ? [
    ['在第三方插件市场安装', '在 Obsidian 的第三方插件市场搜索 AgentWiki Sync，安装并启用。'],
    ['在浏览器中批准', '打开插件设置，点击“连接 AgentWiki”。在浏览器登录并允许连接，然后回到 Obsidian。'],
    ['选择空间和本地文件夹', '连接成功后，在插件中选择空间和要映射的本地文件夹，再按提示同步。'],
  ] : [
    ['Install from Community Plugins', 'Search for AgentWiki Sync in Obsidian Community Plugins, then install and enable it.'],
    ['Approve in your browser', 'Open the plugin settings and click “Connect AgentWiki”. Sign in and approve in your browser, then return to Obsidian.'],
    ['Choose a space and local folder', 'Once connected, choose a space and the local folder to map, then follow the sync instructions.'],
  ];
  return (
    <article className="min-w-0 text-gray-900">
      <header>
        <p className="flex items-center gap-2 text-sm text-gray-500"><Gem size={18} /> AgentWiki Sync</p>
        <h1 className="mt-4 text-2xl font-semibold">{zh ? '连接 Obsidian' : 'Connect Obsidian'}</h1>
        <p className="mt-3 max-w-2xl text-base leading-6 text-gray-600">{zh ? '在 Obsidian 中写作，与 AgentWiki 空间同步。先连接账号，再选择空间和本地文件夹。' : 'Write in Obsidian and sync with an AgentWiki space. Connect your account, then choose a space and local folder.'}</p>
      </header>
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label={zh ? '开始连接' : 'Start connecting'}>
        <h2 className="text-lg font-semibold">{zh ? '在插件设置中点击“连接 AgentWiki”' : 'Click “Connect AgentWiki” in the plugin settings'}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{zh ? '插件会打开浏览器授权页。批准后回到 Obsidian，连接会自动完成。' : 'The plugin opens browser authorization. Approve and return to Obsidian; the connection finishes automatically.'}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <a href={OBSIDIAN_PLUGIN_URL} aria-label={zh ? '在 Obsidian 中打开' : 'Open in Obsidian'} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">{zh ? '在 Obsidian 中打开' : 'Open in Obsidian'}<ExternalLink size={15} /></a>
          <a href="#connect" className="text-center text-sm font-medium text-gray-700 underline underline-offset-4">{zh ? '使用手动连接码' : 'Use a manual connection code'}</a>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-500">{zh ? '找不到连接按钮？更新插件，或使用手动连接码。' : 'No connection button? Update the plugin or use a manual connection code.'}</p>
      </section>
      <ol className="mt-6 grid gap-3 lg:grid-cols-3">
        {steps.map(([title,body],index)=><li key={title} className="rounded-xl border border-gray-200 p-4"><p className="text-sm text-gray-500">0{index+1}</p><h2 className="mt-2 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-gray-600">{body}</p></li>)}
      </ol>
      <section id="connect" className="scroll-mt-6" aria-label={zh ? '手动连接后备' : 'Manual connection fallback'}>
        {token ? <ObsidianConnectionPanel /> : <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">{zh ? '手动连接码' : 'Manual connection code'}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{zh ? '浏览器授权不可用时，登录后生成十分钟有效的连接码，粘贴到插件的手动连接入口。' : 'If browser authorization is unavailable, sign in to generate a code valid for ten minutes and paste it into the plugin’s manual connection option.'}</p>
          <Link to="/?intent=workspace&returnTo=%2Fguide%2Fobsidian%23connect#login" className="mt-4 inline-flex rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">{zh ? '登录后生成连接码' : 'Sign in to generate a code'}</Link>
        </div>}
      </section>
      <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} />{zh ? '同步前确认变更' : 'Review changes before syncing'}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{zh ? '连接不会自动同步笔记。先选择空间和文件夹；同步时检查变更，冲突需要你确认。' : 'Connecting does not sync notes automatically. Choose a space and folder first, review changes when syncing, and confirm conflicts yourself.'}</p>
        <p className="mt-3 text-sm text-gray-600">{zh ? '本服务器地址：' : 'This server’s address:'}</p><code className="mt-1 block break-all text-sm text-gray-700">{window.location.origin}</code>
      </section>
      <a href={GITHUB_RELEASE_URL} aria-label={zh ? '下载最新 Release' : 'Download latest Release'} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-gray-600 underline underline-offset-4"><Download size={16} />{zh ? '下载最新 Release' : 'Download latest Release'}</a>
    </article>
  );
};
