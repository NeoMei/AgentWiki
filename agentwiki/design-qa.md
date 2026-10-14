# Agent 聊天界面视觉与交互验收

最终结果：passed

## 目标与边界

依据用户选定截图，简化真实 AgentSessionPanel 与 AgentReferencePicker。采用顶部会话标签、浅灰用户气泡、白底 Markdown 回复、底部一体输入框和按需引用弹窗。保留已有页面工具栏、页面布局、问答/候选模式及人工接受后显式保存流程。

参考图：`/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/codex-clipboard-66aea094-d5d6-42c7-bda3-6f75c4495649.png`（2400×1350）。比较时排除参考图的桌面渐变背景、应用窗口外框及另一产品的导航，以文档与聊天内容区归一化对照；不声称像素级复制。

本地验收使用真实 PagePreview / PageEditor / AgentSessionPanel，接口和内容均为合成 fixture，不连接真实模型、生产账号或生产服务。阅读侧栏沿用既有约400px宽度，编辑侧栏沿用可调整宽度；参考图的模型选择器不映射为虚假功能，使用现有会话模式入口。

## 浏览器证据

Codex In-app Browser，DPR 1。桌面1600×1000、短桌面1280×720、手机390×844。参考图与实现截图已在同一次工具输入中并排检查。

证据目录：`/tmp/agentwiki-chat-qa-20261014/`

| 文件 | 内容 |
| --- | --- |
| desktop-final.png | 阅读页：轻量会话、用户气泡、Markdown 回答和底部输入 |
| editor-reference-final.png | 编辑页：同一聊天组件与引用搜索弹窗 |
| mobile-reference-popup.png | 手机引用搜索边界 |
| mobile-overflow-before.png | 压力场景修复前的裁切证据 |
| mobile-stress-final.png | 五引用、两条展开笔记、错误提示的修复后完整布局 |
| editor-accepted-draft.png | 接受到草稿后仍需保存的明确提示 |

## 发现与修正

| 问题 | 修正与复验 |
| --- | --- |
| 引用弹窗在窄侧栏裁切，并引起横向滚动 | body Portal + fixed 定位；同时约束于侧栏和 visualViewport，滚动/缩放重定位；真实桌面、手机及几何测试通过 |
| 输入法方向键被搜索结果导航截获 | composing / keyCode229 守卫；专门测试覆盖 |
| 空/失败候选及接受后的保存提醒被折叠隐藏 | 错误候选自动展开，已接受记录与保存提示保持可见；单元和真实候选流程通过 |
| 五引用+展开笔记+错误挤出底部 | composer 最多面板55%，引用与笔记独立滚动，输入/发送保留空间，错误最少40px；手机面板 clientHeight=scrollHeight=505、clientWidth=scrollWidth=356，发送与完整错误均在边界内 |
| fixture 热更新重复 createRoot 警告 | fixture 加入 HMR dispose；不涉及生产入口 |

最终无未处理的 P0/P1/P2 视觉或本次交互问题。

## 交互与代码验证

- UI 实测新建会话、历史切换、会话草稿保留、Shift+Enter换行、Enter发送、运行后停止、@引用、方向键+Enter选取、五引用上限、笔记批量加入上下文、失败后保留输入。
- 接受候选后 Save 启用，但 fixture 服务端仍不含新增正文；点击 Save 后回读才包含新增正文，证明未绕过草稿与保存边界。
- 账号/Space/token 隔离、来源快照、笔记回执、延迟 POST/切页以及候选冲突继续由原有业务测试与独立复审覆盖。
- 客户端全量151文件 / 2464测试通过（client-final.log）；Panel41、ReferencePicker22、Notes28均通过。
- 最终 client build、TypeScript、lint、diff check通过；构建保留已有大 chunk 提示。
- 实现分工后独立复审，并对最后CSS与fixture增量再次复审，无剩余阻断。

交付状态：本地实现和验收完成，未推送 GitHub、未部署生产。预览服务仅监听127.0.0.1，按本地演示交付保留。
