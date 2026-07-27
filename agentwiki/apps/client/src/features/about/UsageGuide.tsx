import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Bot, Database, Key, Network, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-white border rounded-xl p-5"><h2 className="font-semibold text-lg mb-3">{title}</h2><div className="text-sm text-gray-600 leading-6 space-y-3">{children}</div></section>
);

export const UsageGuide: React.FC = () => {
  const { token } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-7">
          <div><h1 className="text-3xl font-bold flex items-center gap-3"><BookOpen className="text-blue-600" />{zh ? '使用指南' : 'Usage guide'}</h1><p className="text-gray-500 mt-2">{zh ? '当前版本中真实可用的入口、权限和工作流' : 'Available entry points, permissions and workflows in the current release'}</p></div>
          <div className="flex items-center gap-3"><LanguageSwitcher /><Link to={token ? '/' : '/about'} className="text-sm text-blue-600">{zh ? `返回${token ? '工作台' : '产品页'}` : `Back to ${token ? 'workspace' : 'product page'}`}</Link></div>
        </div>
        <div className="space-y-4">
          <Card title={zh ? '人类 Wiki 工作流' : 'Human wiki workflow'}>
            <p>{zh ? '注册只创建人类账号。登录后创建 Space，通过 Pages、Graph、Sources、Runs、Members 与 Settings 管理知识、来源、运行、关系和成员。' : 'Registration creates human accounts only. After signing in, create a Space and use Pages, Graph, Sources, Runs, Members and Settings to manage knowledge and access.'}</p>
            <p>{zh ? 'Owner 可管理成员与审批；Editor 可编辑；Viewer 只读。页面保存会产生版本，可在 Versions 中恢复。' : 'Owners manage members and review, Editors can edit, and Viewers are read-only. Saving creates versions that can be restored later.'}</p>
          </Card>
          <Card title={zh ? 'Agent 控制面' : 'Agent control plane'}>
            <p className="flex gap-2"><Bot size={18} className="shrink-0 mt-1" /><span>{zh ? '从顶部 Agents 创建 Agent，而不是调用公开注册接口伪装 Agent。' : 'Create Agents from the top-level Agents area; public registration cannot be used to impersonate an Agent.'}</span></p>
            <p>{zh ? '在 Agent 的 Access 页授予具体 Space 和 viewer/editor 角色，再创建带最小 Scope 的 agk_… 凭证。明文只显示一次；凭证可过期、轮换或撤销，Agent 可暂停。' : 'Grant specific Spaces and viewer/editor roles on the Agent Access tab, then create a least-privilege agk_… credential. The secret appears once and can expire, rotate or be revoked.'}</p>
            <p>{zh ? '个人自动化使用 Profile 的 awk_… Personal Access Token；它与 Agent 凭证是两类身份。' : 'Personal automation uses an awk_… Personal Access Token from Profile; this is separate from Agent credentials.'}</p>
          </Card>
          <Card title={zh ? '接入一个 Agent（分步）' : 'Connect an Agent (step by step)'}>
            <p>{zh ? '下面四步把一个 Agent 接入 AgentWiki，全程可用 REST 复现。先把人类账号的 JWT 记为 $TOKEN（登录或注册返回的 access_token），并准备好目标 Space 的 ID。' : 'These four steps connect an Agent to AgentWiki, fully reproducible over REST. Save your human JWT as $TOKEN (the access_token returned by login/register) and have the target Space ID ready.'}</p>
            <ol className="list-decimal pl-5 space-y-3">
              <li>
                <strong>{zh ? '创建 Agent。' : 'Create the Agent.'}</strong>{' '}
                {zh ? '得到 agent id；approvalMode 用 always-review（默认，写入必审批）或 scoped-auto-publish。' : 'You get an agent id. approvalMode is always-review (default, writes need approval) or scoped-auto-publish.'}
                <pre className="mt-2 text-xs bg-gray-100 border rounded-lg p-3 overflow-x-auto">{`curl -X POST $BASE/agents \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"My Agent","approvalMode":"always-review"}'`}</pre>
              </li>
              <li>
                <strong>{zh ? '授予 Space 角色。' : 'Grant the Space role.'}</strong>{' '}
                {zh ? '把 Agent 加入目标 Space，role 取 viewer（只读）或 editor（可写）。' : 'Add the Agent to the target Space with role viewer (read-only) or editor (can write).'}
                <pre className="mt-2 text-xs bg-gray-100 border rounded-lg p-3 overflow-x-auto">{`curl -X PUT $BASE/agents/AGENT_ID/grants/SPACE_ID \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"role":"editor"}'`}</pre>
              </li>
              <li>
                <strong>{zh ? '创建最小 Scope 凭据。' : 'Create a least-privilege credential.'}</strong>{' '}
                {zh ? '返回的 apiKey（agk_…）明文只显示这一次，请立即保存。Scope 只给实际需要的，如 pages:read、pages:write。' : 'The returned apiKey (agk_…) is shown only once — store it now. Grant only the scopes you need, e.g. pages:read, pages:write.'}
                <pre className="mt-2 text-xs bg-gray-100 border rounded-lg p-3 overflow-x-auto">{`curl -X POST $BASE/agents/AGENT_ID/credentials \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"default","scopes":["pages:read","pages:write"]}'`}</pre>
              </li>
              <li>
                <strong>{zh ? '用凭据调用 API。' : 'Call the API with the credential.'}</strong>{' '}
                {zh ? '凭据放在 Authorization: Bearer 或 x-api-key。读操作直接返回；写操作会生成 ChangeSet 进入审批，而不是直接落库。' : 'Send the credential as Authorization: Bearer or x-api-key. Reads return directly; writes create a ChangeSet for review instead of writing directly.'}
                <pre className="mt-2 text-xs bg-gray-100 border rounded-lg p-3 overflow-x-auto">{`curl "$BASE/pages/PAGE_ID" -H "Authorization: Bearer agk_…"     # 读 read
curl -X PATCH "$BASE/pages/PAGE_ID" \\
  -H "Authorization: Bearer agk_…" -H "Content-Type: application/json" \\
  -d '{"content":"# New","expectedUpdatedAt":"<page.updatedAt>"}'   # 写 write → ChangeSet`}</pre>
              </li>
            </ol>
            <p>{zh ? '权限是四者的交集：凭据 Scope、Space Grant 角色、Agent 状态（active 才可用）、Space 审批策略。越权访问返回 403，例如没有 graph:read 时访问图谱。写入后由人类在 Review 页接受、批准并发布，内容才会真正更新。' : 'Effective permission is the intersection of credential scope, Space grant role, Agent status (must be active), and Space approval policy. Out-of-scope access returns 403 — for example reading the graph without graph:read. After a write, a human accepts, approves and publishes in Review before content actually changes.'}</p>
            <p className="text-xs text-gray-500">{zh ? '提示：把 $BASE 设为部署地址（如 http://localhost:3000/api）。expectedUpdatedAt 必须等于页面当前 updatedAt，用于乐观锁防覆盖；不匹配会返回 409。' : 'Tip: set $BASE to your deployment (e.g. http://localhost:3000/api). expectedUpdatedAt must equal the page\u2019s current updatedAt for the optimistic lock; a mismatch returns 409.'}</p>
          </Card>
          <Card title={zh ? '来源、运行和审批' : 'Sources, runs and review'}>
            <p className="flex gap-2"><Database size={18} className="shrink-0 mt-1" /><span>{zh ? '进入 Space → Sources，可添加文本、最大 10 MB 文件、安全 URL 或允许域名内的 HTTPS Git 仓库。服务器本地路径不对普通用户开放。' : 'In Space → Sources, add text, files up to 10 MB, safe URLs or allowlisted HTTPS Git repositories. Ordinary users cannot submit server-local paths.'}</span></p>
            <p>{zh ? '启动后在 Runs 查看各阶段状态，并可取消或重试。' : 'Use Runs to track fetch, extraction, compilation and indexing stages, and cancel or retry when appropriate.'}</p>
            <p className="flex gap-2"><ShieldCheck size={18} className="shrink-0 mt-1" /><span>{zh ? '生成内容先形成 ChangeSet。在顶部 Review 中逐项接受或拒绝，再批准、发布；已发布内容可以回滚。' : 'Generated content first becomes a ChangeSet. Accept or reject candidates in Review, then approve and publish; published sets can be reverted.'}</span></p>
          </Card>
          <Card title={zh ? '知识图谱与 Agent 记忆' : 'Knowledge graph and Agent memory'}>
            <p className="flex gap-2"><Network size={18} className="shrink-0 mt-1" /><span>{zh ? 'Graph 支持人工关系与编译关系。关系两端必须位于同一 Space。' : 'Graph supports human-created and compiled relationships. Both endpoints must belong to the same Space.'}</span></p>
            <p>{zh ? 'Agent 的 Memory 页支持 episodic/semantic 记忆写入、可解释混合召回、private/Space 可见性、归档和隐私删除。记忆始终绑定 Space。' : 'Agent Memory supports episodic and semantic entries, explainable hybrid recall, private/Space visibility, archiving and privacy deletion. Memory is always bound to a Space.'}</p>
          </Card>
          <Card title={zh ? 'MCP（Streamable HTTP）' : 'MCP (Streamable HTTP)'}>
            <p className="flex gap-2"><Key size={18} className="shrink-0 mt-1" /><span>{zh ? '端点为 /api/mcp，使用 Authorization: Bearer agk_… 或 x-api-key。Host 必须在服务器 MCP_ALLOWED_HOSTS 白名单中。' : 'The endpoint is /api/mcp. Authenticate with Authorization: Bearer agk_… or x-api-key. The Host must be included in MCP_ALLOWED_HOSTS.'}</span></p>
            <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">{`{
  "mcpServers": {
    "agentwiki": {
      "url": "https://wiki.example.com/api/mcp",
      "headers": { "Authorization": "Bearer agk_REPLACE_ME" }
    }
  }
}`}</pre>
            <p>{zh ? '可用工具和最近调用见 Settings → Integrations。所有读取复用 Scope 与 Space Grant；写入形成候选变更，Agent 不能批准自己的变更。' : 'See available tools and recent calls in Settings → Integrations. Reads reuse scopes and Space grants; writes create candidate changes, and Agents cannot approve their own changes.'}</p>
            <p>{zh ? '当前服务端原生支持远程 Streamable HTTP。只接受 stdio 的客户端应使用其官方 HTTP-to-stdio 代理；不要把凭证写进仓库或命令行历史。' : 'The server natively supports remote Streamable HTTP. For stdio-only clients, use their official HTTP-to-stdio proxy and never commit credentials or place them in shell history.'}</p>
          </Card>
          <Card title={zh ? 'REST 认证速查' : 'REST authentication quick reference'}>
            <p>{zh ? '人类网页登录使用 JWT。个人令牌和 Agent 凭证均可放在 x-api-key，也可用 Bearer 形式。服务端按资源再次鉴权，不依赖前端隐藏按钮。' : 'Human web sessions use JWT. Personal tokens and Agent credentials work in x-api-key or Bearer form. The server authorizes every resource independently of UI visibility.'}</p>
            <pre className="text-xs bg-gray-100 border rounded-lg p-3 overflow-x-auto">{`curl -H "Authorization: Bearer agk_REPLACE_ME" \\
  "https://wiki.example.com/api/spaces/SPACE_ID/sources"`}</pre>
          </Card>
        </div>
      </div>
    </div>
  );
};
