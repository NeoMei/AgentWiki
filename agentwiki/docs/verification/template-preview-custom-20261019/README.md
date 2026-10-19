# 模板预览与自定义模板入口：本地 UI 验证

本次验证通过。实际产品 React 组件 NewContentPage / NewPageDialog / TemplateContentPreview / PageTemplateManager / CreatePageTemplateDialog / SavePageAsTemplateDialog，通过浏览器真实 HTTP 请求访问本地内存 fixture API。没有连接生产，没有证明真实数据库持久化、服务端权限或者发布完成。

## 环境与复现

- 工作树：`/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（末尾空格）；应用目录 `agentwiki`。
- 浏览器：Playwright 1.61.1，Chrome channel；1440×900 与 390×844；中文和英文。
- 可浏览页面：`http://127.0.0.1:2714/e2e/fixtures/template-preview.html`。
- 本地 API：`http://127.0.0.1:3424`；只绑定 loopback。数据在内存中，重启即清空。
- synthetic `owner` / `editor` 身份和模板在 fixture 内显式标示。
- 浏览器使用 MemoryRouter，页面顶栏显示真实组件的路由状态；API 通过 Vite `/api` 代理发起真实 HTTP。
- BrowserSkill 独立 Agent Window 另执行了来源页面创建、保存、使用，以及最终选择日报、展开、关闭预览。最终 capture `deec7bfdead65`：0 errors，0 dropped requests；任务窗已关闭。

运行方式（应用根目录）：

```sh
node apps/client/e2e/fixtures/template-preview-api.mjs
```

另一个终端（`agentwiki/apps/client`）：

```sh
AGENTWIKI_DEV_API_ORIGIN=http://127.0.0.1:3424 pnpm exec vite --host 127.0.0.1 --port 2714 --strictPort
AGENTWIKI_WEB_URL=http://127.0.0.1:2714 pnpm exec playwright test e2e/template-preview-custom.spec.ts --workers=1
```

测试默认将截图和回执保存至此目录；可通过 `TEMPLATE_PREVIEW_EVIDENCE` 指定其他位置。API fixture 与浏览器用例的端口固定为 3424，启动前应确认端口空闲。

## 结果

最终 5 条 Playwright 用例全部通过，耗时 10.2 秒；完整输出见 `playwright-results.log`。

| 检查 | 结果与证据 |
| --- | --- |
| 页面身份 / 非空 / 框架异常 | 正确标题、真实创建页 heading、没有 Vite overlay；5 个用例无应用 console error/warn |
| 日报正文缩略图 | 标题、表格、任务列表真实 Markdown 渲染；任务勾选不可编辑；`desktop-daily-thumbnail.png` |
| 展开 / 关闭 | 放大预览包含完整正文与只读提示，关闭后焦点返回展开按钮；`desktop-daily-expanded.png` |
| 页面组内容 | 切至第二篇风险清单，正文随选择更换，第一篇正文消失；`desktop-page-group-second-page.png` |
| 自定义入口 | 自定义分类仅显示空间模板，显示不同的团队正文；`desktop-custom-template.png` |
| 创建自定义模板 | 选择已保存 Markdown 页面→填写元数据→保存成功；请求包含源页 expectedSourceUpdatedAt |
| 管理生命周期 | 编辑名称→归档后列表隐藏→显示归档→恢复→直接使用；`desktop-manager-created-restored.png` |
| 使用与目录保留 | 使用模板链接选中已创建模板；创建回执 `targetParentFolderId=reports`，正文与源页一致；`manager-http-receipt.json`、`desktop-template-use-result.png` |
| editor 权限呈现 | 创建页无管理入口；可发现/选择自定义模板；直接进入管理 fixture 路由时无创建/编辑/归档按钮；`desktop-editor-custom-use.png` |
| 390px 布局 | 无文档横向溢出，底部“下一步”在视口内，预览可展开关闭；管理和源页选择弹窗不溢出，四个创建方式入口均完整在视口内 |
| 英文 | New content / Manage custom templates / Content preview / Read-only preview / Create template from page 等呈现正确，390px 可操作 |

## 视觉核验

已实际读取桌面缩略图、桌面放大预览、页面组第二页、管理列表、移动缩略图、移动放大预览、移动管理页和英文移动预览截图。模板正文现已在右侧卡片显示；移动端放大窗保持在视口内，长正文可滚动，操作栏可见。

原始反馈中的空预览被正文渲染取代；自定义模板管理入口位于创建页标题区，自定义使用入口位于创建方式导航，管理页可从已保存页面新建模板并使用。

初次构建中的 fixture favicon 404 已在 fixture HTML 添加 data favicon 消除。开发过程中 LanguageContext 热更新曾使 BrowserSkill 旧页面出现临时 Context 错误；重新加载后的 BrowserSkill 最终 capture 与五条清洁 Playwright 运行均无此错误。这些开发过程现象不算产品修复项。

## 边界

- 模板、身份、权限回执、版本冲突和实例化结果均来自内存 API；这是本地真实渲染与交互验收。
- 没有验证生产发布、线上模板数据、真实认证/授权、数据库事务、并发请求或真实页面编辑器中的“保存为模板”菜单。
- 英文界面测试保留中文合成模板正文，用于验证界面文案与正文不被混淆。
- source-manifest.json 记录验证时源文件 SHA-256。若主代理后续改动相关文件，需按影响范围复跑。

## 保留的本地服务

主代理要求暂留本地服务以便独立复核：

| 服务 | 端口 | exec session | PID |
| --- | --- | --- | --- |
| Vite | 127.0.0.1:2714 | 98973 | 98890 |
| 内存 HTTP fixture | 127.0.0.1:3424 | 32443 | 98865 |

服务 PID 已通过 lsof 绑定核实。BrowserSkill ejbm 已停止。清理服务由主代理执行。

最终源码冻结后再验：已包含深链接失败/缺失处理、NewContentPage 局部翻译 hook 和 creation 文案迁移。全部五条 UI 再次通过（10.2 秒），日志、截图、内存 HTTP 回执与 source-manifest 同步更新。此次未修改产品代码。
