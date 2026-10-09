# 决策

- 沿用单份Markdown源，表格局部事务保真；不引入全文转换或CRDT。
- 页面链接使用现有受权Space搜索，空查询为最近页，结果数诚实限定。
- 当前已核验p5c07ff/gpt-6-astra/ultra，子代理继承并各自核验，禁止fallback。

- 表格：CodeMirror默认规范化CRLF，而lineSeparator改为LF会显示CR控制字符并改变光标/换行语义。本轮对无法无损映射的CRLF/混合行尾明确回退源码；不得静默格式化或把helper的CRLF测试冒充产品可视编辑通过。代价是此类表格仍需源码编辑，后续需独立无损映射适配。

最终产品213a2aae：保持单源/raw-span/显式Save。真实浏览器发现与集中修复4项闭环；完整验收、无保存回读与独立清理通过。所有Ruling已归档execution-ledger及acceptance，CRLF退回源码和容量限制复用代理的代价保持明确。
