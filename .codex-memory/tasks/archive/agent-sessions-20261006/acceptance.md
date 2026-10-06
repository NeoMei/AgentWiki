# AgentWiki 统一 Agent 会话侧栏第一阶段验收

> 2026-10-07最终补充：旧1735f341混合状态批注P2已由f4325942修复，并通过独立组件探针与真实浏览器验收及清理。本期完成归档；最终结论和边界见[补修验收](../agent-session-mixed-notes-20261007/acceptance.md)。以下仅保留原冻结候选的历史回执。

状态：产品与实际 UI 验收完成，独立整体代码审查 APPROVED，R1–R4、F1/F2 全部关闭；owned 运行时清理与独立复核完成；本地交付完成。

## 交付行为
- 阅读/编辑共享同账号同 Space 的多轮会话；跨页面保留上下文，刷新恢复服务器历史。Cmd/Ctrl+L 打开侧栏。
- 阅读选文可建立本机私人批注，显式添加所选笔记和参考文档后发送；历史保留当时的引文、批注、文档与参考资料版本。
- 问答、修改候选、运行状态和停止分开显示；候选逐项接受到草稿，正式保存仍由用户点击。
- 原文、版本、身份和局部范围守护仍生效；允许安全的候选与人工改稿交错，各次接受可单独撤销。

## 代码与审查
- 分支 codex/document-workspace；本轮基线 ee9348839924fd7566ff3b67fa72beb6090a77ea。
- 后端 b5e80d7a，Task1 四项发现已独立复审关闭。
- 前端29366ae4，加cbd5fc91与5d6c6bad两轮修复；R1范围恢复、R2笔记关联、R3移动阅读工具栏、R4发送期间人工编辑竞态均已独立复审关闭。
- 冻结产品HEAD 1735f341167950e58dca935b819bc2e188133f88。整体审查后经3cc1d78c与1735f341定向修复并独立复核，无剩余finding；验收文档另行提交。
- 所有实现/审查使用实际 p5c07ff/gpt-6-astra / ultra，见 actual-models.json。

## 验证层次
| 层次 | 已确认事实 | 证据 |
|---|---|---|
| 后端自动检查 | 159 suites /2877通过 /26既有skip；typecheck/build/lint | server-after-fix.log、Task1报告 |
| 前端自动检查 | 最近全量139 suites /2091通过（3cc1d78c）；最终1735f341为8suites/260定向测试及typecheck/lint/build通过，JS548914/550000 | final-fix/client-full.log、final-fix-round2/*；未将基线全量回执冒充最终小修重跑 |
| 迁移保护 | 61文件corpus已独立批准；6保护测试通过；原60文件hash未变 | Task1审查/5fd5e944 |
| 实际API/DB/worker | 13检查通过：幂等、单活跃轮次、原文历史、隔离/撤权/删除、限额、135768字节中文stdin、415ms实际取消 | runtime-r2/http-db-receipt.json |
| 实际生产构建UI | 阅读选文/批注/引用/发送、跨页历史、两hunk+手工编辑+3Undo+3Redo、冲突/重生、Stop、三尺寸 | ui-acceptance.md、ui-undo-receipt-latest.json、截图；增补阅读390、跨读写notes resolved、F1实际8秒延迟Send切edit与F2整篇Conflict→Regenerate→Send→Accept解决原note通过 |
| 保存边界 | 接受前后正式API/DB不变；显式Save后3589字符与预期全量一致，main新版本15:38:56.334Z，sibling不变 | runtime-r2/page-checkpoint-{pre-accept,pre-save,post-save}.json |
| 真实外部模型 | 未验：隔离运行时没有加载真实provider凭据，回复来自确定性fixture CLI | runtime-r2/runtime-report.md |
| 本机ACP | 只完成接口与能力契约，无本机connector、tool/permission或Follow Mode | docs/architecture/agent-runtime-adapter.md |
| 发布部署 | 未执行push/merge/release/deploy；只保留本地分支 | 产品HEAD1735f341；最终文档提交另见Git历史 |

## 验收数据与边界
本轮浏览器和API只使用owned本机测试账号、独立PostgreSQL schema、独立Redis与API/worker。确定性CLI经真实生产router/runner执行；它验证协议、数据隔离、终止和UI流程，不证明外部模型的生成质量。未发送的笔记只保留在本机。正式Save是隔离fixture内的明确验收动作。

会话最多100轮，提示词取最近最多10个completed轮次、120000字符内。接受/丢弃记录只在当前应用registry中；Undo改变正文不回退历史动作记录。发送成功的私人批注回执可跨SPA页面生命周期交付；不保证浏览器进程被终止时中断请求的本机批注绑定恢复。原始Markdown仍为单一数据源。

## 实施裁定
1. 最终整体审查覆盖ee934883..最终HEAD及受影响周边代码；早先文档工作区切片沿用其已有独立审查。代价：若旧交互遗漏，需追加修复与审查。
2. 第一阶段每会话100轮、模型上下文最近最多10个已完成轮次。代价：更长对话需新建会话，后续再做分页与上下文策略。

## 清理
浏览器已退出测试账号、恢复网络/视口并关闭owned tab4。CUA不支持清除该origin storage，测试专用本机笔记/偏好可能仍留在隔离浏览器的localhost51904 origin。运行时已按owner/PIDstart/schema限定清理并独立复核：schema、自有API/worker/Redis/preview/fixtureCLI、launchd、uploads/temp均不存在，51903/51904/50536关闭；public inventory未变；runtime.json及api.log已删除。见runtime-r2/final-cleanup-receipt.json与final-cleanup.md。清理前最终API/DB读回仍精确3589字符，sibling未改，active0，见final-post-ui-readback.json。
