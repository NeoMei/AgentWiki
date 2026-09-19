# AgentWiki 会话交接文档

交接日期：2026-09-09。本文是用户明确要求生成的本次会话完整交接快照。项目长期上下文仍以 `.codex-memory/current.md`、`.codex-memory/spec/index.md` 和任务归档为准，不要恢复向旧 handoff 文件不断追加历史的做法。以下版本、服务状态和数据数量均为本次会话核验结果；下次操作前应重新检查可能变化的状态。

## 1. 当前结论与正在做的任务

本次任务已经完成，没有正在执行的开发、审查或部署步骤。用户希望借鉴 Wiki.js 的目录与文章组织、呈现方式，改善 AgentWiki 的 Space 目录、阅读、编辑及相关子页面；随后要求清理代码与技术债，反复进行任务审查、代码审查和前后端/UI 测试，修复所有确证且值得修复的问题，完成后发布。应用已经发布并部署到生产 **v0.10.2**，服务端和客户端都已更新，API 和 Worker 已重启。用户最后追问“server 端也更新了吗”，本会话再次通过 SSH 确认 Server/Client 均为 0.10.2，API/Worker 正常运行，公网健康检查全部通过。

最后一项工作是生成本 `HANDOFF.md`。写入本文前，主仓、本任务工作树和五个参考仓库均干净，master 与 origin/master 一致。本次交接文档只写入本地，尚未提交或推送；不要把因此出现的 `?? HANDOFF.md` 误认为遗失的产品改动。没有因编写交接再次构建、部署或修改发布标签。

## 2. 用户已经确认的范围与不能改变的规则

参考站为 https://docs.requarks.io/en/home 。用户明确要求只借鉴 Wiki.js 的目录和文章组织、呈现方式，其他继续遵守 AgentWiki 现有规则，不能为了界面调整重写已经完成的后台逻辑。

已经接受的界面方向是：左侧 Space 目录、适合阅读宽度的文章正文、右上角按需打开的本文目录浮窗；浮窗效果参考 Codex Desktop。用户随后要求给目录树增加类似 Obsidian 的层级细线，并确认效果。必要的 Space 子页面外框、导航、历史与返回上下文一并调整，不能只改文章页而让相关页面割裂。

稳定领域约束：Folder 表达目录，Page 承载正文，`folderId` 是目录归属的事实源。预览不保存，保存成功后仍留在编辑器；保留未保存离开保护、CAS 保存、冲突处理、权限校验与 `treeRevision`。本轮没有改变数据库 schema、同步协议或已应用迁移。

特别注意目录权限的精确规则：普通 Space **Owner/Editor 可以写目录，Admin/Viewer 不可以**；平台 `super_admin` 例外必须依据实时 User 数据确认。普通 Space admin 与平台 super_admin 不是一回事。依据是 `agentwiki/docs/superpowers/specs/2026-08-28-space-folder-hierarchy-design.md` 第249–253行附近。通用 AuthorizationService 可能将 editor 权限扩展到 admin，但目录规则必须额外保持精确检查。曾有审查者把“Admin 被拒绝目录写入”误判为 bug，核对规格后撤回；绝不能再次擅自扩大该权限。

用户已在本任务中授权修复、整合、发布、服务器备份、部署和专用合成数据验收，不需要对已经完成或同一授权范围内的每个步骤反复确认。但本任务已经结束，不应无新需求再次部署、发布、操作真实知识内容或启动其他产品的发布链。

## 3. 仓库、分支、提交与版本

真实仓库目录末尾有一个空格：`/Users/neomei/项目/codexprojects/AgentWiki `。应用代码在其下 `agentwiki/`。本任务使用的隔离工作树是 `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`，分支为 `codex/full-audit-20260909`；这棵工作树是本会话原阅读工作区任务延续使用的，不要另开一个同名目录覆盖它。

Git common directory 为 `/Users/neomei/.local/share/AgentWiki.git`，其 `core.worktree` 指向主目录。所有针对主仓或隔离工作树的 Git 操作都要在正确仓库根目录执行并显式带 `--work-tree="$PWD"`。不要在应用子目录 `agentwiki/` 下误把它作为整个 Git 工作树。操作参考仓库自身时用 `git -C <参考仓库路径>`，不要把主仓的 worktree 参数传进去。

| 对象 | 已核验状态 |
| --- | --- |
| 本地 master / origin/master | `bbe5c1f5febeaa9af88e80fd82611b8ec23e7d93` |
| 本任务分支 | 已快进到同一 `bbe5c1f5`，写交接前干净 |
| v0.10.2 不可变标签 | `c7d98444d5935923026733cd55d4fdfbd076fd45` |
| 最新运行修复提交 | `74f885ed2861969fb18c241f26e65eb2ced5de0e` |
| 主分支完整候选整合验证 | `8d48b47c3813d114d2ba31c6eda724d586110aa2` |
| 应用 root/server/client | 均为 `0.10.2` |
| Local Sync / Sync Protocol | 分别保持 `0.9.1` / `0.6.0` |
| Obsidian 插件 | 本任务没有更新或发布；项目记录为 `0.4.0`，不代表本轮实测了实际 Vault 安装 |
| GitHub Release | https://github.com/NeoMei/AgentWiki/releases/tag/v0.10.2 ，正式发布，非 draft、非 prerelease |

重要提交链：

| 提交 | 内容 |
| --- | --- |
| `175b7bf0` | 修复编辑器保存后迟到 GET 覆盖，以及离开后 POP 返回光标丢失 |
| `62e92277` | 搜索词法索引串行化与旧向量失效 |
| `391f2ecd` | 目录五个 Web 写入口在事务内重新核验实时权限 |
| `be25c772` | 保留目录原有120秒事务额度 |
| `63cfdea1` | 同步应用0.10.2版本契约 |
| `74f885ed` | 修复运行和开发依赖的安全通告 |
| `8d48b47c`、`c7d98444` | 全面验证与生产验收记录；后者是发布标签目标 |
| `260985f9` | 发布后只补齐五个参考仓库的 `.gitmodules` |
| `bbe5c1f5` | 记录参考仓库元数据收尾 |

master 比发布标签多出的内容只有 `.gitmodules` 和交接/验收记录，应用运行输入没有变化。这是正常且已核验的差异，不是“服务端没有部署最新修复”。不要为让 SHA 看起来一致而重新部署，也不要移动已经发布的 v0.10.2 或更早标签。本次未执行 npm 发布，工作区依赖升级也不会自动更新用户已经安装的外部 Local Sync。

## 4. 已经完成的实现与修复

原阅读工作区 Task1–7、相关子页面适配、目录层级细线、发布前代码整理与技术债处理已经完成，先后交付了0.10.0、0.10.1；用户追加全面复审后，基于0.10.1再次修复并交付0.10.2。不要把归档中较早的“未发布”“待验收”状态当成当前状态重新执行。

编辑器：成功 PATCH 后递增读取序列并取消旧请求，使保存前、保存中发起的旧 GET 不能晚到后覆盖已保存正文或版本。保存期间用户的新输入仍保持 dirty，不被覆盖。位置捕获改为 layout cleanup，在 React 清空 imperative handle 前记录位置；真实卸载/POP 回归验证光标恢复。主要文件为 `apps/client/src/features/page/PageEditor.tsx` 及其 spec。

搜索：`indexPage` 在短 Prisma 事务中先锁 Page 行，再读取实时快照，并在同一事务发布词法索引。正文 hash 改变时原子清空旧 embedding vector，避免“新 hash + 旧 vector”继续被当成有效。外部 embedding 调用保持在事务之外，最终仍检查当前标题、正文、deletedAt 和文档 hash 的 CAS，失败后可重试。主要文件为 `apps/server/src/core/search/search.service.ts`、其 spec 和 `scripts/composite-template-effects-policy-db.test.mjs`。

目录授权：create、rename、move、delete、restore 五个 Web 写入口在同一事务内执行实时 User 锁、Space/tree 锁、实时权限复核和原有目录变更。锁顺序是 User → Space，不反转；传入原有 locked transaction 路径，不能给内部已经授权的 Agent/Sync 操作重复套锁。复审发现新 wrapper 若使用 Prisma 默认5秒事务会破坏大树操作，因此复用原120秒额度。实际 controller 的10000对象 rename 约14.7秒、54次结构查询，满足60次查询预算。

依赖：Hono 升到4.13.5，Multer 升到2.3.0，js-yaml 两个 major 分别升到3.15.2/4.3.2，Vitest 升到4.1.11。现有 Vite 保持6.4.3。生产和全部依赖 audit 均为0；共消除9个不同通告涉及的11个包/版本条目，不能说成11个独立漏洞。保留原供应链策略，仅对必要的版本例外做最小调整。

参考仓库元数据：最终检查发现已有五个 gitlink 没有 `.gitmodules`，导致 `git submodule status` 报错。已补齐路径与各原仓库的 origin URL，随后只登记已有子模块配置，没有更新、重新下载或改动参考项目的代码。五个仓库为 docmost、mnemon、openwiki、outline、swarmvault；状态均正常、HEAD与gitlink一致且文件干净。这项补充经过独立复审，不属于应用部署包。

## 5. 审查和测试证据

已完成初审、分项修复与独立复审、整分支最终审查、依赖修复后的独立增量审查，以及最后的仓库元数据独立审查。所有最终审查均为 Critical0 / Important0 / Minor0。在本轮明确覆盖范围内，没有已确认且仍未修复的问题；不能由此声称所有外部环境或未来输入绝对零 bug。

最终去重后的测试通过数量为 **5494**，剩余两项未运行的是 Windows 原生验证。

| 套件 | 最终结果 |
| --- | --- |
| runtime 非数据库 | 263通过；默认关闭的CodeGraph另行开启补验 |
| 真实 CodeGraph | 1通过；扫描器是真实本地CLI，远端publish为受控替身 |
| runtime 真实数据库 | 207通过，0跳过 |
| server | 2571通过，1项Windows原生跳过 |
| client | 1426通过，103个测试文件 |
| Sync Protocol | 140通过，10个测试文件 |
| Local Sync | 886通过，1项Windows原生跳过，61个测试文件 |
| 构建、lint、类型检查 | 全仓通过 |
| 生产依赖/全部依赖 audit | 均为0 |

主分支快进整合后又重新完成冻结安装、全仓 build/lint/typecheck、runtime264/264（这轮直接打开CodeGraph）、client1426、protocol140、LocalSync886及audit0。最终相同运行代码的DB207和server2571已经通过；没有为了增加数字把多轮重复执行重复计数。

两项 Windows 边界分别为 server 的 Windows OpenCode 可执行文件原生启动，以及 Local Sync 的 Windows ACL 检查。不要把最初三个 skip 全称为平台 skip：其中一个是后来已经补跑成功的 CodeGraph 显式门禁。

真实 UI 验收覆盖新建Space/多层目录/选中目录建页、阅读渲染、KaTeX公式/代码高亮/Mermaid、未保存预览、保存留在编辑、checkbox持久化、搜索最新正文、历史预览返回编辑、图谱选择跳转、协作向导及设置保存。路由套件覆盖5个公开、15个认证、7个移动路由和7个旧路由重定向；无浏览器错误、API5xx和水平溢出。HTTP/MCP32项、目录角色HTTP7项在本地和公网均通过。

本地CUA窗口实际808×987，公网CUA窗口实际1280×720；仓库Playwright验收为1440×1000与390×844。不要凭想象写成同一viewport。公网CUA沿用了已登录的Admin会话，仅操作本轮专用合成Space；普通Owner/Editor/Admin/Viewer边界由独立HTTP测试验证。目录细线与浮窗截图已经目视确认，保存后的 `PUBLIC-V0102-SAVED` 和已勾选任务均经独立API回读、浏览器刷新确认。

本轮实际观察到了离开编辑的确认提示，但没有成功记录显式“取消离开”的GUI动作，不能补造这条人工证据；相关自动化回归仍有覆盖。看到协作向导的空Agent提示，不等于完成了真实外部Agent运行。

## 6. 生产服务器与备份

| 项目 | 值或本轮验证结果 |
| --- | --- |
| 公网地址 | https://agentwiki.quukk.com |
| 公网API | https://agentwiki.quukk.com/api |
| SSH目标 | `root@113.249.120.24` |
| 会话使用的SSH控制socket | `/tmp/agentwiki-release-ssh/control`；下次使用前核验是否仍有效 |
| 应用目录 | `/root/agentwiki` |
| 生产数据库 | `127.0.0.1:5432/agentwiki`，schema `public`，DB角色 `agentwiki` |
| PostgreSQL / vector | 本轮核验16.14 / 0.8.6 |
| 附件目录 | `/var/lib/agentwiki/attachments` |
| systemd作用域 | root用户的 `systemctl --user` |
| 三个服务 | `agentwiki-api.service`、`agentwiki-worker.service`、`agentwiki-frontend.service` |
| API/Worker启动时间 | 2026-09-09 15:29:06 CST |
| 配套备份 | `/var/backups/agentwiki/frontend-v0102.TVyUV6` |
| 前版应用 | `/root/agentwiki-previous-20260909152906` |
| 恢复工具目录 | `/root/agentwiki-release-tools-v0102` |

生产候选先构建成功，再停写并制作数据库、附件、应用、systemd配置的配套备份，随后切换。56个已应用迁移校验和与候选一致，没有新增或待应用迁移，没有未解决迁移记录。生产1412个源码/客户端产物文件与候选一致，447个旧静态资源哈希保留，两份env与备份字节一致。实际加载Hono4.13.5/Multer2.3.0。三个服务active/running，NRestarts0，公网health的database、redis、auditPersistence、attachmentStorage全部ok。

最后只读数据检查为239个活跃页面，词法索引0缺失/0陈旧。该数量只是核验时点快照，下次可能因真实用户写入而变化，不要为恢复这个数字删除数据。所有本轮临时HTTP/UI数据已清理；人工与目录fixture的3个用户、2个Space及文章又经生产只读DB核对，活跃数0。用户原有内容未改。

恢复工具和操作说明已经准备、检查，**并没有在生产执行灾难恢复演练**。恢复会覆盖备份后的用户写入，不属于本次交接授权。不要只换回旧应用目录而不恢复匹配的数据库与附件，也不要混用v0101和v0102的工具、备份命名空间。保留这些备份和旧应用，不要在“清理技术债”时删除它们。不要打印、复制或提交生产env、访问token、数据库密码及测试凭据。

## 7. 本地环境、保留数据与证据位置

交接前再次检查，本地预览 `http://127.0.0.1:5188` 和API `http://127.0.0.1:53088/api` 仍在监听。两个本地Docker容器保留：`agentwiki-reading-pg-20260908` 绑定127.0.0.1:55438，`agentwiki-reading-redis-20260908` 绑定127.0.0.1:56388。没有为结束本会话关闭预览或删除数据库。

全量数据库测试使用专用 `reading_release_test_20260909`，Redis使用DB5；人工/API验收使用另一个数据库 `reading_resume_20260909`。不要把这两个数据库混同，更不能让测试runner指向生产。私有runner会检查Docker端口及身份，设置全部数据库门禁和 `AGENTWIKI_FULL_TEST=1`。不能省略环境变量跑出大量skip后宣布全量通过。PostgreSQL工具使用 `/opt/homebrew/opt/postgresql@16/bin/pg_dump` 与同目录 `psql`。

原“产品知识库”验收Space `cmttd7rny001goiwp7t94c5nz` 和原页面 `f050ba1a-2755-4c53-8498-bd2e0ad3a57c` 保留；用户最初打开的本地入口是 `http://127.0.0.1:5188/pages/f050ba1a-2755-4c53-8498-bd2e0ad3a57c`。本轮新建的“全面复审 20260909”Space `cmttpvjvm001xg25hn1s0cmmn` 已清理，不要因访问它404误判产品故障。公网人工fixture页面 `39a94dd4-4baa-49ef-8988-6bf94a206f1f` 也已随专用Space清理。

完整私有证据根目录：`/Users/neomei/.codex/recovery/agentwiki-full-audit-20260909/`。其中包括：

- `final/`：产品修复后的全量日志、依赖升级各轮日志和audit结果；`post-deps/`：依赖修复后最终runtime/DB/server、HTTP/UI与真实CodeGraph复验。
- `main/`：主分支复验日志；`main-gate.py`：该主分支复验runner。
- `final-review.md`、`dependency-final-review.md`、`task-5-report.md`、`task-6-report.md`、`task-6-review.md`：独立复审和任务报告。
- `deployment-verification.json`、`production-after.json`、`services-after.txt`、`deploy.log`：部署校验；`public-cleanup-db.json`和其他cleanup账本：精确清理证据。
- `public-reading-toc.png`、`public-after-save.png`、`public-ui-route-desktop-editor.png`、`public-ui-route-mobile-page.png`：公网截图。
- `ops/`：本次版本适配的备份、部署、恢复工具；只作为有明确目标时的操作依据，不能看到脚本就重新执行。
- `start-server.mjs`：本地启动辅助脚本，引用原工作树内的私有runtime配置。使用前核对端口和目标，不能将其中配置写进Git。

SDD协调记录位于主仓 `/Users/neomei/项目/codexprojects/AgentWiki /.superpowers/sdd/full-audit-20260909/`，不是仅工作树中的同名目录。曾因core.worktree导致helper把报告写到主仓，寻找证据时不要误以为报告丢失。本轮所有代理任务已完成，不需要唤醒旧代理继续猜测工作。

前轮代码清理备份在 `/Users/neomei/.codex/recovery/agentwiki-code-cleanup-20260909/`：五个参考仓库4969个文件的行尾差异先按原始字节备份后恢复；47个未跟踪文件也曾全量备份，2个旧副本/临时文件归档，45份资料保留并本地忽略。不要把被忽略的私有证据或保留资料当作垃圾再次删除。

## 8. 遇到的困难与绝不能再踩的坑

1. **路径末尾空格与Git定位。** 主仓与工作树绝不能用未引用的路径；不要因为工作树状态看起来不对就reset、clean、切其他会话分支。先核对真实路径、common Git目录、当前分支和显式worktree。五个参考项目的.gitmodules已经补好，不要删除或改引用提交。
2. **把呈现变化变成后台规则重写。** 目录规则、CAS、同步、schema都是既定边界；尤其普通Admin目录写入被拒绝是正确行为，不是权限bug。
3. **在事务外检查权限就认为安全。** 本轮复现了等待锁期间被降权仍写入的窗口；必须在同一写事务中按固定锁顺序复查实时权限，不能相信旧req.user中的super_admin状态，也不要重复或反向锁。
4. **新事务wrapper悄悄丢掉超时额度。** Prisma默认5秒不够10000对象目录操作；必须复用原120秒限制，而不是削减数据规模让测试过关。
5. **并行build与依赖dist的测试。** 曾有一次测试与另一个代理的Nest构建重叠，dist被删除重建，产生4个Cannot find module失败；这不是新业务bug。保留失败证据、停止重叠、等完整构建成功再顺序复跑，不能用这轮作为最终验收。不要让多个代理同时安装依赖、构建共享产物或跑同一DB套件。
6. **Vitest4并非只改版本号。** `restoreMocks`不再清理全部模块mock的调用历史和一次性实现，导致20个前端测试失败。client显式`mockReset:true`恢复之前隔离语义；forks的execArgv移到test.execArgv；LocalSync显式排除dist，防止重复执行编译后的测试。补直接@types/node依赖，保留全部断言。Vitest4移除了`--minWorkers`，新命令保留`--maxWorkers=2`即可。
7. **把测试环境错误当产品回归。** 本地最初缺少`LOCAL_SYNC_PACKAGE_VERSION=0.9.1`导致能力校验409，应修私有环境配置，不能放宽生产版本校验。目录创建fixture需要显式`parentId:null`；登录接口可能返回201，私有清理器应接受实际成功状态200/201并核对身份。
8. **保存与索引并发的假安全。** 保存后必须使旧读取失效，不能只看请求返回先后；光标必须在ref解绑前捕获；索引必须先锁后读当前Page，而不是锁前抓旧快照；远程模型调用不能占着DB锁。
9. **通过审计就宣布外部安装已更新。** audit只证明当时的依赖解析；工作区override不改变外部已经安装的LocalSync/Obsidian。两个发行链独立，本次没有npm或插件发布。
10. **只看health或截图就算验收。** 本次实际点击、保存、刷新、API回读和角色HTTP检查都有证据。不要编造未观察到的“取消离开”、Windows、真实Vault、外部Agent或灾难恢复结果，也不要把受控远端替身称为真实外部发布。
11. **为消除bundle警告裁剪Mermaid。** 完整上游懒加载解析器690864字节，保留明确720000字节预算；不能通过删除图表类型或取消预览功能让构建变绿。
12. **新部署删除旧静态资源或重写env。** 用户可能有旧标签页，必须保留旧资源。部署已校验两份env字节一致，不能随机生成或覆盖既有生产secret。发布成功后的清理也不能删除匹配备份。
13. **发布标签必须等于master的误解。** v0.10.2固定c7d98444，master多了参考映射及记录，运行输入仍完全相同；不要force-push或改tag来掩盖正常元数据差异。
14. **清理误伤。** 只能清理本任务有明确ID、归属和命名空间的fixture；用户原始验收空间、真实知识内容、其他会话worktree、私有资料及备份必须保留。清理后还需核验，不能靠“DELETE已发出”就宣布完成。

## 9. 下一步计划与接手流程

当前没有待修复、待合并或待发布的应用任务。下一个会话先读本文、`.codex-memory/current.md`和spec索引，核对master、origin、标签以及本地工作树；知道本文件是本轮新增未提交文档即可，不要因此重跑发布。若用户只是询问状态，读取版本、服务状态和公网health即可；不要自动进行生产写入。

若用户提出新开发需求，从当前主线建立该任务的隔离工作树，先明确范围并保留上述领域约束。遇到代码定位需求，应用目录已有 `.codegraph/` 时先用CodeGraph；没有索引的工作树不要擅自为了工具创建索引。独立任务可按届时有效的技能/代理指令拆分，编辑、构建和DB资源必须明确所有者，不能复现本次并行产物冲突。

只有用户需要对应验收时，才继续两项Windows原生测试、独立Obsidian实际Vault验收、真实外部Agent/付费模型流程或恢复演练。这些是明确未覆盖的环境边界，不是隐藏的已知产品bug。历史向量没有强制全部重新生成，当前零陈旧词法索引也不能证明所有历史向量文本一致；若未来需要历史向量修复，应单独设计可审计的重建范围、模型成本和失败重试，不要直接对生产全量重跑。

可用的只读接手命令示例：

```sh
cd '/Users/neomei/项目/codexprojects/AgentWiki '
git --work-tree="$PWD" status --short
git --work-tree="$PWD" rev-parse HEAD origin/master 'v0.10.2^{}'
git --work-tree="$PWD" submodule status
curl -fsS https://agentwiki.quukk.com/api/health
ssh -S /tmp/agentwiki-release-ssh/control -o BatchMode=yes root@113.249.120.24 'systemctl --user show agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service -p Id -p ActiveState -p SubState -p NRestarts'
```

SSH socket失效不意味着服务器故障；先核验连接状况，不要猜测凭据或把连接失败当作部署失败。上述命令不执行发布、恢复、迁移或数据清理。

## 10. 关键文档入口

- [本轮全面复审与生产验收报告](</Users/neomei/项目/codexprojects/AgentWiki /agentwiki/docs/verification/full-audit-v0102-20260909.md>)。
- [当前项目上下文](</Users/neomei/项目/codexprojects/AgentWiki /.codex-memory/current.md>)。
- [本轮任务归档](</Users/neomei/项目/codexprojects/AgentWiki /.codex-memory/tasks/archive/full-audit-20260909/brief.md>)。
- [原阅读工作区设计](</Users/neomei/项目/codexprojects/AgentWiki /docs/superpowers/specs/2026-09-08-agentwiki-reading-workspace-design.md>)与[实施计划](</Users/neomei/项目/codexprojects/AgentWiki /docs/superpowers/plans/2026-09-08-agentwiki-reading-workspace.md>)。
- [目录领域与权限规格](</Users/neomei/项目/codexprojects/AgentWiki /agentwiki/docs/superpowers/specs/2026-08-28-space-folder-hierarchy-design.md>)。
- [前轮代码清理与技术债记录](</Users/neomei/项目/codexprojects/AgentWiki /agentwiki/docs/verification/workspace-cleanup-tech-debt-20260909.md>)。
- [GitHub正式发布页](https://github.com/NeoMei/AgentWiki/releases/tag/v0.10.2)。

交接完成标准：接手者应能区分已完成产品工作、已部署服务端、不可变发布标签、后续仓库元数据、本地保留环境和未执行的外部验收；不能从旧记录推导出新的隐含开发或发布任务。
