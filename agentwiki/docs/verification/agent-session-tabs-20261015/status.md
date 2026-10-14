# Agent 会话标签关闭修复

日期：2026-10-15（北京时间）

## 基线与问题

- 基线：v0.12.33 / a71942bc，隔离分支 `codex/agent-session-tab-close`。
- 生产 Chrome 真实页面确认：右侧 Agent 会话栏显示最近会话标签、创建和历史入口，没有关闭按钮。
- 根因：`AgentSessionPanel` 直接从历史列表取最近会话作为标签；`useAgentSession` 没有独立打开标签集合，重挂载还会自动选择历史第一条。
- 修改前定向基线：`AgentSessionPanel.spec.tsx` 48/48 通过；该结果说明既有测试没有覆盖关闭行为。

## 修复行为

- 标签可关闭；后台标签关闭不改变当前会话，当前标签关闭后选择相邻标签，全部关闭显示空态。
- 会话历史、未发送输入、候选和接受记录保留；关闭不调用服务端删除或取消。
- 发送请求、首次历史列表或新建会话请求未返回时暂不允许关闭；详情读取中可关闭，已运行的任务继续执行，可从历史重开。
- 打开状态按用户和空间隔离，只在浏览器存储会话 ID 与选中 ID，关闭后刷新不重新填满。
- 沿用现有页面样式和中英文文案；验证键盘操作和窄屏。

## 验证结果

- TDD：新增 17 例先红后绿，Panel 从 48 例增加到 65 例；覆盖关闭当前/后台/最后标签、历史重开与草稿、刷新与身份隔离、存储异常、运行任务及迟到请求、加载/新建竞态、首发草稿转移和窄屏关闭入口。
- 独立复审：Panel 65 + Notes 28，共 93/93 通过；最终无可确认的 P1/P2 阻塞。代码差异 SHA256：`9aa1dd2bf93a0d012954255be792a81b57fa762f4d26661006c18f89f83b9e9f`（不含本文及验收附件）。
- `tsc --noEmit`、相关 ESLint、`git diff --check`、client build 均通过；构建保留现有大 chunk 提示。
- 最终全客户端：156 文件，2572 通过 / 1 失败。唯一失败是 `KnowledgeGraph.grouped.spec.tsx:180`，`expected 65 to be less than 25`。完整导出的未改动 v0.12.33 基线同样 2555 通过 / 1 失败；同一基线单文件 13/13 通过。已确认属于基线问题，本次未改动图谱；不得将全客户端描述为全部通过。

## Chrome 实际界面验收

生产原页面用于确认缺陷；修复验收使用本地合成 API 与实际 `PagePreview` / `PageEditor` / `AgentSessionPanel`，没有调用真实模型或更改生产数据。

| 场景 | 结果 |
| --- | --- |
| 关闭后台标签 | 当前选择与输入保持 |
| 关闭当前/最后标签 | 选择相邻标签；全部关闭进入空态 |
| 从历史重开 | 会话仍在，当前页面生命周期内未发送草稿保留 |
| 键盘 Delete | 当前标签关闭，焦点和选择落到右邻标签 |
| 阅读/编辑切换 | 打开的标签和输入保留，已关闭标签不自动补回 |
| 全部关闭后刷新 | 仍为空态，不自动创建会话 |
| 运行任务中关闭 | 标签消失；历史重开得到“已完成”；空态未复活已发送输入 |
| 窄屏 | 390px 模拟设备、浏览器 110% 缩放，CSS 视口 354px；选中关闭按钮右边界 261.53px，小于滚动区右边界 264.65px；实际点击可关闭，无页面横向溢出 |

窄屏验收发现并修复了关闭按钮被裁切的问题：按完整标签（含 X）定位，监听标签和容器尺寸变化；不改变焦点、不滚动正文。首次列表竞态和首发空态草稿复活问题也在独立审查后补测试修复。

- [历史重开与输入保留](desktop-reopened.png)
- [键盘关闭与相邻焦点](keyboard-close-neighbor.png)
- [窄屏编辑页关闭入口](narrow-editor.png)
- [全关后刷新空态](closed-after-clean-reload.png)
- [脱敏验收回执](acceptance.json)

最终浏览器捕获 `d706701f19725` 未丢弃请求/操作；运行测试只发送创建会话和创建 turn 两个 POST，没有取消或 DELETE。两条控制台错误来自 `chrome-extension://invalid/`，不是网站异常。早期开发捕获受 HMR 与存储上限影响，只作为诊断材料，不作为最终请求完整性依据。

## 发布与生产回验

- 用户授权发布后，v0.12.34 已推送至 GitHub master 并建立 tag/Release。发布提交：`479419eff227a09350dd7cdc695450de238bb894`；主检出用户改动未触碰。
- Web/API/client 均为 0.12.34，Local Sync 0.13.0、protocol 0.6.1 不变。完整 `pnpm build` 通过；独立核对发布包、Git 提交与源码 manifest 均为 1325 文件，无缺失、额外或哈希不符。
- 部署前暂停 API/Worker，完成并核验数据库、128 个附件、应用、配置与服务单元的配套备份：`/var/backups/agentwiki/session-tabs-v01234.y8z56d5p`。备份后恢复服务；原始私有备份保留服务器，不进入 Git。
- `deploy.sh 113.249.120.24 root` 退出码 0；63 个迁移无待执行项，保留旧应用 `/root/agentwiki-previous-20261015054835` 与 4506 个旧客户端资源。
- 生产 1325 个源码文件逐一与发布提交一致；3 服务 active，内网与公网 health 的 status/database/redis/auditPersistence/attachmentStorage 均为 ok。公网 5 个入口资源 SHA256 与服务器构建产物一致。
- Chrome 在用户原文章 URL 实测当前标签关闭与相邻选择、从历史重开并保留临时输入、全部关闭后整页刷新保持空态。已清除临时输入并恢复原 3 个标签、原顺序和原选择；没有发送模型任务或修改文章。
- 浏览器捕获没有丢弃请求/操作，Assist 写请求为 0；两条控制台错误均来自 `chrome-extension://invalid/`。原始生产页面截图与捕获仅保留本机 `/tmp`，不提交。
- [GitHub Release](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.34) · [生产回执](deployment.json)

## 本地诊断材料

- 原始浏览器捕获、测试及基线日志保留在 `/tmp/agentwiki-session-tabs-final.json`、`/tmp/agentwiki-tab-close-client-final2.log`、`/tmp/agentwiki-tab-baseline-client-complete.log`；不提交原始生产页面数据。
