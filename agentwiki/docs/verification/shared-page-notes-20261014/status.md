# 页面共享笔记与右侧工具栏验收

日期：2026-10-14。基于本地 `codex/editor-single-line-selection`；尚未推送 GitHub 或部署生产。

## 最终行为

- 新笔记直接保存服务器；所有有页面权限的用户和 Agent 可见，显示可信作者，不增加分享按钮。
- 旧本地笔记只迁移当前账号、Space 和页面，幂等保存确认后才清理；请求失败保留草稿。
- 文字高亮和行旁黄色图标常驻；右上四图标切换目录、信息、Agent、笔记，切换保留草稿。
- 页面成员可读和添加；Agent reader 只读，editor/publisher 可写；仅作者修改和删除。正文编辑仍需原 canEdit 权限。
- REST 与 MCP list_page_notes/create_page_note/update_page_note/delete_page_note 共用服务；作者身份不能由提交者任意指定。
- 页面笔记存储独立于 Markdown；不会仅因打开面板、自动迁移或加入待发送而自动请求 Agent。
- 其他成员的笔记在页面加载、窗口重新聚焦和每 30 秒刷新时读取；当前版本未增加笔记专用 WebSocket 推送。

## 审查

三个独立实现分工后经过服务端、客户端和最终集成复审。发现并修复：

1. 笔记写入与页面改名的 Space/Page 锁顺序冲突：遵循现有 Space advisory 锁边界。
2. 401/403/404 后旧请求回执及排队状态可能重新显示笔记：请求 epoch、abort 与旧动作失效，重新授权的新读取可恢复。
3. 异步保存期间新输入可能被旧成功回执清空：保存时暂时禁用输入，失败仍保留草稿。
4. 工具栏方向键进入 Agent 时焦点不应跳到输入框；四个 aria-controls 均有稳定 tabpanel。
5. 已提交的状态 PATCH 在普通路由切换中被取消：改为按原账号/Space/页面排队完成，新页面读取前等待保存回执；账号、token 变化或明确失权仍取消。PATCH 设置 15 秒超时并在鉴权拦截器之后检查 token，避免旧操作借用新账号身份。
6. 新建笔记的回执与另一笔记状态保存并发时，新笔记缺少队列中的并发版本：只补入缺失笔记的服务器回执，保留队列已有版本；延迟 POST/PATCH 回归先复现失败，再验证新笔记实际保存为 dispatched。

最终独立集成复审无阻塞发现。

## 自动化证据

- 类型检查、lint、全项目生产构建通过；构建仍有既有 bundle 大小提示。
- 新增真实 PostgreSQL + 完整 Nest AppModule/CombinedAuthGuard + HTTP + MCP SDK 门禁：7 pass / 0 skip。
- runtime 非数据库门禁 309 pass / 1 existing skip。
- 该门禁验证 human/Agent 互读、作者归属、viewer 注释、读者 Agent 禁写、同会话撤权、跨作者拒写、OCC、伪造作者拒绝、幂等迁移、墓碑防复活、不改 Markdown、并发改标题与两个主体笔记写入。
- 全仓数据库批次 237 pass / 2 fail / 0 skip；两处失败来自并行构建暂时清空 dist。停止并行构建后分别重跑：page-publication 1/1、real-agent-harness 4/4 均通过，全部 239 项数据库门禁最终获得通过回执。第一次补跑漏环境变量的 publication 失败保留日志，不算通过。
- server 177 suites / 3156 pass / 4 existing skips；sync protocol 140 pass；local-sync 998 pass / 1 existing skip。
- 客户端最终 151 files / 2434 pass / 0 fail；最后代码重新通过 TypeScript、全客户端 lint 与生产构建。
- AgentSessionNotes 保留原 27 项生命周期语义，新增真实 pending PATCH 跨路由回归后 28/28 通过；最终 hook/API 80 项覆盖迁移、权限撤销、跨路由保存、超时释放及并发创建/状态更新。

日志：`/tmp/agentwiki-shared-notes-{full-test,http-db,server-all,client-all,protocol-all,sync-all,db-rerun,publication-rerun,typecheck,lint,build}.log`。

最终客户端日志：`/tmp/agentwiki-shared-notes-client-{final,build-final,lint-final}.log`；精确并发回归：`/tmp/shared-notes-lane-new-note-{red,tests,tsc,lint}.log`。整仓测试按上述分阶段回执完成，未把第一次中断的 `pnpm test:full` 记为一次性全绿。

## 真实 Chrome UI

使用原生 Chrome 操作真实 PagePreview/PageEditor 组件，本机隔离合成 API；不是生产账号验收。

- 新增笔记到服务端后，切换另一账号看到同一记录、内容和原作者；直接 GET 合成 API 亦回读一致。
- 人类作者显示姓名及当前作者“我”，Agent 显示机器人标识。
- 阅读与编辑页面的高亮、黄色行图标和面板定位可见；关闭面板仍保留标记。
- 四图标左右键切换，经过 Agent 时焦点留在标签；Agent 未发送文本在信息/Agent 切换中保留。
- 390×844 下阅读及编辑笔记面板进入正常文档流，没有横向遮挡；面板正文有独立有界滚动。
- 无新应用异常；fixture 的协作 WebSocket 切换警告与既有 Chrome extension 无效资源错误不作为服务器协作传输验收。
- 恢复桌面尺寸、关闭 DevTools 和本次验收标签页，保留用户原有标签页。

截图：

- [阅读页面及作者](reading-shared-authors.png)
- [编辑页面](editor-shared-notes.png)
- [编辑态关闭面板后的标记](editor-markers-panel-closed.png)
- [窄屏阅读](mobile-notes.png)
- [窄屏编辑](mobile-editor.png)

## 交付边界

- 正式上线需要先执行新增 PageNote 迁移，再部署服务端/客户端与新 MCP gateway；当前仍为本地候选。
- 本次隔离 PostgreSQL 测试库、Redis、API fixture、Vite 均已清理，5178/5182/6398 测试端口关闭。
- 旧私有本地数据只在其所属账号访问对应页面时迁移；不会扫描其他账号或其他浏览器。
- 浏览器用合成 API 证明界面，真实 REST/MCP 测试用隔离 PostgreSQL 证明权限与落库；没有把 fixture 当成生产回执。
