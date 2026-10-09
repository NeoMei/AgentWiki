# 构建预算补修限定源码复审

## 身份与范围

- BASE `167237a1d70b36a9dfb05a97438717a01b714201` → HEAD `d6c3934a609590ffbc1cf0e27f7c650ed5113f9c`。
- 仅审冻结 `review-167237a1..d6c3934a.diff` 的四个文件，以及此拆分直接相关的 import/导出、预算常量和现有检查回执。未派代理、修改产品/Git或重跑测试；只写本报告。

## 核对结果

- **语义和导出保持。** `src/i18n/system-collaboration-keys.ts:7` 的完整 lookup 与冻结 diff 中移出的声明逐字一致；Todo key 的计算表达式也保持。messages 模块仅将原有 `systemTodoTexts`、`systemReviewTexts` 改为 export，翻译数组、索引顺序、双语字典内容不变。现有 parity 日志确认 lookup 225 项、英文229项、中文229项分别与 BASE 等值。已核对 src 全部 lookup 引用：唯一生产消费者 `systemTemplateText.ts:1` 已改到新模块，无漏改的旧导入。
- **依赖方向正确，没有新增循环。** 应用语言字典仍依赖 messages；协作功能依赖 keys，再单向引用 messages 中的 tuple。messages 不反向导入或 re-export keys，因此不会把 lookup 重新带回首屏。产物归属与源码相符：fixed JSON 中 keys 在 `RunDashboard-PMHBXx4z.js`，`initial=false`；messages 仍在入口。既有 Mermaid circular chunk 警告不属于本次模块拆分新增的源码循环。
- **可信来源路径未改。** `systemTemplateText.ts:4-16` 的 system/spaceId/slug 检查、服务端 systemTemplateSource 判定、显式 null 保留自定义内容及旧 DTO fallback 均原样保留；只是第一行 import 改路径。不存在通过文本查找表绕过来源证明的新分支。
- **测试未弱化。** E2E 保留布局、未加载不批准、冲突恢复和唯一 POST 断言，仅在 conflict=true/reload 前追加真实中文→英文→中文切换，验证系统任务、Todo、审核条件及原样 Agent 名。首跑英文标签错误期望修正为既有实际文案，未修改产品文案来迎合测试。
- **预算未放宽，问题实际解除。** diff 未改预算、Vite 配置、依赖或锁文件；`build/bundleBudget.ts:11` 仍为550000。读取诊断 JSON 得当前553177、旧文案对照549099、修复542577字节；首屏实际减少10600、余7423。green build 日志包含预算插件 `542577/550000`，并保留lazy parser例外和原circular/large chunk提示。

## 证据与限制

- 已读取 client 完整日志：141 files / 2234 passed；focused 6 files / 84 passed。实现回执列出 typecheck、client lint、生产 build 成功；不存在的 LanguageContext.spec.tsx 未被算作覆盖。
- 已读取生产 preview 浏览器日志：旧深链接2项在首跑通过，协作项因新增测试期望错误首跑失败；修正后协作1项通过。它们是实际生产打包产物/Chrome界面与 API fixture，不是真实生产部署或真实后端授权验收。
- 最新 `/tmp/agentwiki-1008-bundle-preview-green-tests.log:4` 再次有 NO_COLOR/FORCE_COLOR 环境告警。此为检查输出噪声，不是代码 finding，不影响该PASS；最终记录不得再概括“所有最终浏览器运行无warning”。无需为清除噪声重复测试。
- root 报告 BASE 完整 test 为6952通过/6 skip（2 Windows、1 CodeGraph opt-in、3 connection DB opt-in）；这属于167237a1。当前d6c3934a的准确增量证据为上述完整client、定向检查和生产preview。root 另确认当前SHA完整build于13:23:06 UTC exit 0，日志 `/tmp/agentwiki-1008-final-build.log`，预算542577/550000；该项全仓build门禁已完成。

## Findings / Verdict

**Critical = 0；Important = 0；Minor = 0（新增源码 findings）。Approved。** 构建首屏超预算通过实际模块边界调整解决，翻译和可信来源行为保持，没有降低测试或预算要求。

**此前 final-review.md 与 final-rereview.md 的源码批准仍有效。** 本报告把主仓库批准范围延伸至d6c3934a；插件仍为d1d89de，M1保持已关闭。root已确认最终全仓build成功，因此此前预算失败门禁也已解除，候选可以进入本地交付/合并决策。既有工程告警和未验原案/原生平台/provider边界继续保留；本批准不表示已合并、发布或部署。
