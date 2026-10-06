# 文档工作区第三轮验收

状态：已完成本轮确认的5项，独立复审无未关闭问题，最终生产构建浏览器验收与临时环境清理通过。

## 范围与候选

用户确认继续完成选区恢复、目录当前项可见、面板偏好、当前Space完整授权搜索、保真可视表格五项。保持现有品牌与CodeMirror单一Markdown源；所有保存仍需显式操作。

- 分支：`codex/document-workspace`。
- 本轮基线：`f1ed2bb0d7d8b7faedb218405d87fb070ffd58f7`。
- 首次完整产品候选：`bd83b1b73b35f78e399418329fad8a3841447a52`。
- 最终产品候选：`213a2aae`（集中修复`18626a37`及其键盘边界补正）。
- root与各实现/独立审查代理的实际turn_context均核验为`p5c07ff/gpt-6-astra / ultra`；不是只检查配置默认值。
- 未合并、push、发布、部署；原工作目录仅保留原有未跟踪research目录。

## 实现与审查

| 任务 | 产品提交 | 独立审查 |
| --- | --- | --- |
| 完整正反向选区 | f652b804 | [Task1](reviews/task-1.md) |
| 目录切页定位/底部菜单 | 83c990b7 | [Task2](reviews/task-2.md) |
| 大纲/协作面板偏好和宽度 | c6f68442、24fe9c0b | [Task3](reviews/task-3.md)、[几何修复复审](reviews/task-3-rereview.md) |
| 当前Space授权搜索 | e46939e0 | [Task4](reviews/task-4.md) |
| 保真可视表格 | bd83b1b7 | [Task5](reviews/task-5.md) |

逐项审查通过后，[整体审查](reviews/final-review-initial.md)结合生产浏览器发现3项P2；初次单测通过不等于完整产品验收。具体复现见[初次浏览器记录](browser-initial.md)。同一集中修复过程中，定向复审又发现工具栏焦点下翻页键的边界，已修复并在浏览器重验。最终[定向复审](reviews/final-rereview.md)全部4项关闭，见[修复报告](reports/final-fix.md)。

## 验证与边界

初次候选：135客户端测试文件、1,987测试通过；仓库typecheck通过；lint 0error、3项既有serverwarning；生产build通过。首屏JS548326/550000字节；单chunk500000门槛及既有Mermaid完整parser720000例外不变。见logs/initial-*。

最终：135客户端测试文件、**2,006测试通过**；仓库typecheck及最终客户端tsc通过；lint 0error、3项既有serverwarning；生产构建通过，首屏**548576/550000**字节。日志[final-client-tests](logs/final-client-tests.log)、[final-typecheck](logs/final-typecheck.log)、[final-lint](logs/final-lint.log)、[final-build](logs/final-build.log)。既有Mermaid循环chunk/大chunk提示保留，未修改预算规避。

[桌面与390px实机验收](browser-final.md)通过，包括真实选区方向与导航、目录切页和刷新、面板偏好、跨100页服务端搜索、表格无操作/取消/编辑/结构修改/一次撤销、CRLF可见回退。最终UI源码逐字等于基线；[API回读](runtime/no-save-receipt.json)于11:27:35Z确认两页title/content/updatedAt完全未变。

[独立清理回执](runtime/cleanup-receipt.json)于11:27:36Z确认临时schema、服务进程、launchd job、Redis/上传目录和凭据材料已清除，原public inventory不变。浏览器已退出临时账户、关闭自建tab并reset视口。没有生产变更。

## 实际交付边界

- 表格支持顶层规则GFM、最多100行（含表头）/30列；保留未改动单元格/行，结构操作只规范目标表格；取消/无修改应用不写原文，实际应用可一次撤销。
- 原始CRLF/混合行尾若与现有CodeMirror规范化文档不一致，表格面板明确回退源码，不产生修改。这是本轮的保真取舍：尚需独立无损行尾映射能力才可开放这类文档的可视表格。helper的CRLF测试不代表产品已支持。
- 全功能WYSIWYG、图片属性/完整嵌套列表块UI、CRDT不属于已确认五项；本机私人笔记未扩展跨设备共享。
- Windows、原生中文IME、真实多人压力和外部provider未在此轮验收；隔离环境无worker和provider调用。
- 执行容量限制曾使新代理创建失败，Task3复用此前仅负责runtime的代理、Task2复用未编辑目录的代理审查；仍保持实现/审查独立，代价是上下文隔离弱于全新代理。最终整体验证未放宽。
