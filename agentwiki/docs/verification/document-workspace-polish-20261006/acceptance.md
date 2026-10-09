# 文档体验第二轮验收

2026-10-06。用户要求“改的不错，继续优化”。分支 `codex/document-workspace`，第二轮基线 `28e07dbd14dfe49ecfbb3ce503debf073d573241`，最终产品提交 `b8c2ddf7`。第一轮产品与更广范围检查见 [上一轮验收](../document-workspace-20261006/acceptance.md)。

## 产品变化

- 长文候选默认直接展示变更和邻近3行上下文；未改动段可键盘展开/收起，支持完整预览切换、新增/删除计数。截断预览明确标注局部统计。
- 独立候选优先展示编号变更与已接受进度；整篇对比收进可展开区域，保留原文/候选下载及显式采纳。
- 私人笔记默认未解决，支持全部/未解决/已解决筛选、数量、全选可发送项、清除选择和批量发送；切换筛选、发送、失效与重开后不保留隐形旧勾选。
- 无选区且无未完成输入时收起笔记输入框；长引用和正文换行、限高，保留失效原因和重新打开。读屏名称包括可见数量。

## 验证

| 项目 | 结果及范围 |
| --- | --- |
| 第二轮全客户端 | 131 suites / 1865 tests passed，dcfccd3e |
| 最终P3修复 | b8c2ddf7，2 suites / 128 tests passed；三文件eslint、client tsc、diff-check通过 |
| 静态检查 | 全仓pnpm typecheck通过；pnpm lint 0errors，3条既有server unused warnings |
| 最终生产构建 | client build通过，首屏JS547266/550000字节，预算未修改；1项既有懒加载Mermaid parser例外 |
| 独立审查 | 两项任务独立审查、最终整分支审查、唯一P3修复后定向复审完成；未关闭Critical0/Important0/Minor0 |
| 浏览器 | 真正IAB桌面及390px：长文末尾差异/展开/接受/精确撤销，笔记添加/筛选/勾选/发送/部分采纳/重开/第二批发送/接受/撤销通过 |

最终小修复后仅重跑受影响128项与构建，没有重复1865项；第一轮6243通过/6skip为上一轮记录，本轮不将它冒充新执行。原始执行日志暂存 `/tmp/agentwiki-polish-20261006/`；可持久查阅的实现、任务与最终审查报告在 [reviews](reviews/whole-branch-review.md)，详细操作证据见 [浏览器回执](browser-receipt.md)。

## 验收边界

单份Markdown、显式接受、独立撤销、版本/身份/Space/精确选区检查、正式保存路径均保持。笔记仅此浏览器，发送不代表解决；上下文变化时仍保守禁用，编辑器撤销后笔记状态需显式重开。Agent输出为本地可控模拟，未调用真实provider。未新增原生IME、Windows或多人压力验证。

所有本轮代理在账号切换后通过继承上下文启动；已从实际最新turn_context验证p5c07ff/gpt-6-astra/ultra，未回退其他账号。代码审查就绪与发布授权分开：本轮仅本地提交，没有合并、push、发布或部署。

## 环境清理

唯一owned cleanup driver已完成清理并独立复核：新旧自有schema均移除，API/preview/Redis/harness进程不存在，launchd job/plist移除，新旧uploads及Redis数据目录不存在，认证字段清空，公共数据库inventory摘要保持一致。见 [清理回执](cleanup-receipt.json) 与 [旧进程恢复回执](orphan-recovery-receipt.json)。临时进程曾非正常退出，宿主原因未证实；恢复后完成最终生产构建验收。已保存本轮必要回执，删除仅本轮scratch。
