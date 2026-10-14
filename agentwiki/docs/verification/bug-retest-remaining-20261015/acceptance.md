# 剩余问题验收记录

候选基线 v0.12.30 / 286928c0。

## #1 Obsidian

用户补充原环境为黄金书屋，并明确无法复现时按实际情况回复。当前 NeoMei-Docs Vault 仅配置我的知识库 / Wiki 映射（cmsivy4x6000112tow44ehfch），没有黄金书屋原始映射。前序已实际执行自动合并，2026-10-15 本轮 Computer Use 回读显示“本地与服务器已同步，无需操作”，本地和服务器均零变更；下拉菜单仅有该知识库映射。没有遇到指针身份/哈希不匹配。不修改或放宽严格基线校验，不将其他 Space 的成功等同原报告修复。结论：原案未复现，现有映射合并通过。

## 隔离浏览器环境

本地独立 PostgreSQL agentwiki_remaining_test_63414d95a4cb，Redis6395（独立AOF目录），API4399、Vite5199；全新example.test账号和合成内容、两类同名页面、65审核记录、失败来源与可归档Agent。未复制生产数据或凭据，未启用Worker或外部模型调用。

## 已完成真实浏览器/API回归

- #8：@输入→搜索两个同名页面，结果分别显示人物设定/故事章节 canonical path；选中后输入值由“请参考 @”变为“请参考 ”，引用tag出现，焦点回输入框；取消选择保留“取消选择 @”。未发送模型请求。
- #14：历史无failure字段显示“历史记录未保存失败阶段”；通过同结构真实数据库fixture补fetching/REMOTE_REQUEST_FAILED/403后刷新，显示抓取来源、HTTP403、可行建议；展开技术详情清除query token，保留runId/code/status。source-failure-details.png。
- #15：完整长URL显示并可点击复制，UI回读“地址已复制”；浏览器clipboard adapter读值为空，未将adapter空结果当做复制内容一致证据。窄屏物理390px/110%浏览器缩放（CSS354px），documentWidth354/viewport354，无地址横向溢出。source-mobile.png。
- #20：真实本地Agent归档确认→默认列表移除→查看已归档→恢复确认→默认列表显示已暂停；审计数量1→2→3，归档/恢复未删除历史。agent-restored.png。
- #13：新graph API返回2目录5页面，目录直接数量3/2正确；展开人物设定→选择同名参考→侧栏显示canonical path、1关联和打开页链接；搜索故事章节且supports关系过滤显示1/5，路径准确。graph-details.png。

浏览器Vite最初由其他组测试文件HMR触发多次整页reload，已改临时配置禁用watch/HMR稳定验收；后续代码变化需手动reload，不改产品配置。

## #7 真实 MCP HTTP / 数据库审计验收（2026-10-15 02:36）

隔离环境 `/tmp/agentwiki-remaining-20261015`，testDB + API4399。服务端先独立 build；root 重启 API 后执行 `node /tmp/agentwiki-remaining-20261015/mcp-audit-acceptance.mjs`，退出0。未使用生产环境、浏览器或直接写DB绕过授权。

正式人类API为合成Agent `cmv8fahxa002wcgujo4i8m1jd` 恢复active，建立唯一fixtureSpace `cmv8fahpk001ncgujvses08n1` 的Reader Grant，并通过正式local-sync-installations/exchange流程创建身份凭据。实际 `RemoteMcpBridge` 将 `wiki_list_pages` / `wiki_get_page` 映射至注册工具 list_pages/get_page，MCP SDK Streamable HTTP请求 `/api/mcp`，成功读出fixture页面（正文只在内存比对，不输出）。

数据库持久化证据：

| 审计ID | 工具 | 真实目标 | 结果摘要 |
| --- | --- | --- | --- |
| cmv8gba62001ayi8qvu3qlin3 | mcp.tool.list_pages | Space cmv8fahpk001ncgujvses08n1 | success；count=5、total=5 |
| cmv8gba6n001kyi8qknmjzyrx | mcp.tool.get_page | Page da935ed0-3561-4759-8a95-2ccdfe31f001 | success；response=returned |

明确检查新增Agent审计中不存在完整页面正文、人类JWT、身份原始API key、合成密码。get_page正文DTO无可用业务状态/计数，安全摘要为“响应已返回”，不伪造页面发布状态。

脱敏证据：`/tmp/agentwiki-remaining-20261015/mcp-audit-evidence.json`；脚本输出仅agent/space/page/审计ID、状态与计数。内部credentialId仍保留审计关联，原始凭据只保存在权限0600的本地fixture文件供root最终清理。保留Agent active +唯一Reader Grant+凭据供root UI读回，后续统一cleanup。该收据证明本地实际MCP调用和持久化，不代替生产原账号回归。

## 后续真实 UI 回执

- #18/#19：65条真实DB候选，首页25条/共3页；关键词“候选页面 62”能找到首屏外记录。待审核64显示目标标题、空间、提交者/时间和直接提案说明，以及owner审批/拒绝入口。填写原因并拒绝后，pending列表为0；已拒绝搜索“候选页面 64”准确回读1条、状态已拒绝。review-rejected-readback.png。
- #9：阅读页上下文设置真正打开，修改范围选项可见、焦点位于控件；弹层边界x1143/y636/w352/h103位于1554×814视口内，elementFromPoint命中弹层自身；context-settings.png。
- #10：编辑模式同时开启Agent面板，更多页面操作菜单位于最上层（实际elementFromPoint确认），菜单完整可见且Escape关闭；editor-more.png。
- #12：编辑器目录点击第二个“重复标题”，实际CodeMirror可视行落在文档第二处，后续折叠内标题/末标题顺序正确，目标y342位于屏幕内；editor-toc.png。未修改正文。
- #11：通过真实UI创建“提示恢复验收”空文件夹，二次确认软删除，超10秒后大提示自动收起，仅保留“恢复最近删除的文件夹”；点击恢复后两处目录均回读该文件夹。folder-notice-collapsed.png。
- #17：小说模板填故事设定但运行名称空，点击下一页显示“请填写运行名称。”，name.required=true / aria-invalid=true / activeElement=name。run-name-required.png。
- #6：实际创建“隔离草稿第一次”，页面重载仍恢复到映射Agent步骤，点击“开始新运行”回到空输入且聚焦名称；再创建“隔离草稿第二次”。原billy账号/旧浏览器无法代替，同结构旧指针与真实DTO由定向测试覆盖。
- #6/#16：真实列表保留两条不同ID草稿（cmv8gll1z002wyi8qg59thij8、cmv8gm78y002zyi8qybz2fkvd），第二次02:45:01在第一次02:44:32上方，并明确“按创建时间倒序 · 显示时间：创建时间”。run-two-drafts.png。
- #13最终补修真实CUA：先在旧候选把节点拖至最右侧并双击，复现只选中未打开；9c3e79a4预留桌面详情栏后，把故事3拖至画布最右缘(1125,710)双击，最终URL准确为/pages/7767e054-f8ca-40ca-8f19-172a07753fa5，文章标题“故事 3”。graph-doubleclick-open.png。
- #5：本地正式API创建Space模板后，CUA打开“从页面更新内容”。搜索“同名”显示匹配2条、两条完整目录路径和日期；点击人物设定来源后显示“已选择”路径且创建新版本按钮可用。改搜不存在字符显示匹配0条、未找到匹配页面、提交禁用；取消未修改模板版本。source-selector.png。
- #7：CUA活动记录真实读回tool.get_page的Page ID及响应返回、tool.list_pages的Space ID及返回条数5/total5，与SDK调用和数据库收据吻合；历史transport日志明确缺失工具/摘要。mcp-activity.png。
- #9/#10窄屏：物理429px/110%缩放得到CSS390×767，documentWidth390；上下文浮层x25/y259/w340/h103全在视口内，Tab关闭并移至下个可聚焦元素；更多菜单x47/y310/w256/h46可见且elementFromPoint命中自身，Escape关闭。context-mobile.png / editor-more-mobile.png，视口已reset。

## 最终门禁

最终产品代码9c3e79a4；7d9b9dec/58868ff3仅修测试的真实弹层打开顺序和requestAnimationFrame等待，不改产品行为。

全量阶段合计7,458通过、6项既有跳过、最终零失败：Runtime309/1skip、真实DB239/0skip、Server3223/4skip、Client2549/0skip、Protocol140/0skip、Local Sync998/1skip。test:full最初在客户端旧details helper/异步绘制断言处中止，修正后重跑完整155文件客户端2549通过，并执行剩余Protocol/Local Sync阶段；未重复已通过且代码不变的Runtime/DB/Server阶段。不将初次失败命令记为exit0。

pnpm build、pnpm typecheck、pnpm lint及git diff --check均exit0，550,000 bytes首屏JS门禁保持。所有五组初审补修复审及整支终审通过（reviews/final-review.md）；图谱最终边界有真实CUA回执。

生产部署前：root/server/client0.12.30、origin/master286928c0，无新远端提交；1298源码文件与前轮manifest一致。联合备份/var/backups/agentwiki/bug-retest-v01231.FSupLpbg完成，463条manifest验证，数据库44,198,961 bytes；备份含DB、attachments、application、config、service units。备份后三服务恢复active。凭据/授权/Agent状态/空间策略的稳定字段摘要在部署前已保存，仅hash及数量，不含明文。
