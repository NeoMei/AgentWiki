# Task 1 独立审查

审查对象：`d05a8323`；基线：`286928c0`。范围：#5、#6、#16、#17。依据：task-1-brief.md、constraints.md、原 report.md 对应四项、task-1-report.md、task-1-review.diff，以及关联客户端/服务端实际数据流。

## 规格符合结论

**部分符合，#6 尚不可通过。**

| 条目 | 结论 | 依据 |
| --- | --- | --- |
| #5 来源搜索反馈 | 代码符合 | 显示总数、可点击结果、空结果、选中页面名称/路径/日期；维持精确 ID、100 条上限、请求序号、源版本/OCC校验；未自动选择单条结果符合原文的可选建议。 |
| #6 旧运行恢复与重新开始 | 需修复 | 已提供新运行入口、显示服务端状态、按账号分键，并保留服务端记录；但真实草稿 DTO 会绕过新归属检查，另有误删他人旧指针和重试失败后错误解锁两个问题，见下文。 |
| #16 时间顺序 | 代码符合 | 两个列表显示 createdAt 并明确说明；服务端原有 `createdAt DESC, id DESC` 与同字段签名 keyset 游标，显示与排序一致；不要求另改为完成时间。 |
| #17 名称必填 | 代码符合 | required、星号、双语行内 alert、aria-invalid/describedby、焦点定位及编辑后清错均落实。 |

这里的“代码符合”不代表生产原步骤已验收。尤其 #6 的小说 seed / 原 URL ID 同结构模拟不能替代 billy 原账号、原 localStorage 与原数据库记录回放。

## 质量结论

**需要修改后复审：3 项 P2。** 未发现新增服务端权限放宽；修改继续使用现有鉴权、Agent可执行状态检查、OCC与审计。新运行重置会递增初始化、mutation 和成员刷新序号，已有成功回执的主要失效机制保留。但以下数据与失败分支不符合本次明确要求的草稿保护和账号隔离。

### R1 [P2] 真实草稿恢复会丢弃归属字段，使新增账号/模板检查失效

- 位置：`apps/client/src/features/collaboration/RunStartWizard.tsx:234-240`，关联 `loadEditableRun` 的 `1004-1009` 行。
- `getRun` 的真实服务端投影 `HUMAN_RUN_SELECT` 包含 `startedById/templateId`，不包含 `inputs`（`apps/server/src/collaboration-workflows/run.service.ts:105-154`）。因此 draft/ready 正常恢复会进入 `loadEditableRun` 的第二次请求。
- `loadEditableRun` 直接返回 `getRunDraftDetails`，没有合并 summary。该接口只投影 id/name/status/version/inputs/updatedAt/roleBindings，不返回 startedById 或 templateId（服务端 `369-379` 行）。新增的两个检查都以字段存在为前提，所以真实草稿均跳过归属检查。
- 复现：共享 legacy key 属于账号 A；同 Space 的账号 B 打开同模板；summary 正确带 A 的 startedById，但 draft-details 丢失它。代码将 A 的草稿迁移到 B 的 scoped key，删除共享旧指针，并让 B 进入映射/编辑流程。B 后续点击返回并保存可以更新 A 的草稿；服务端现有编辑权限不会阻止同 Space 的合法 editor 更新。这是错误自动选择草稿的问题，不是新服务端越权。
- 现有 `does not adopt another starter’s legacy pointer` 测试把 `inputs` 放在 `getRun` mock 里，因此没有经过真实双请求形状，未验证上述路径。
- 修复建议：在拿到 summary 后先校验归属，或在 loader 中合并 summary 与详情并保留服务器身份字段；新增 summary 无 inputs、details 无身份字段的另账号和模板不匹配回归。

### R2 [P2] 开始新运行会删除未采用、未核实归属的其他账号 legacy 指针

- 位置：`apps/client/src/features/collaboration/RunStartWizard.tsx:184-185`。
- 复现：当前账号已有 scoped 草稿，同时 legacy key 仍存另一账号尚未迁移的草稿。初始化优先读取 scoped，完全不会读取或核实 legacy。此时点击“开始新运行”却无条件删除两个键。
- 结果：当前账号只想脱离自己的草稿，却清除了另一账号的自动恢复入口。服务器草稿尚在不等于原恢复入口被保留；这也抵消了本次按账号分键的保护。
- 修复建议：仅删除当前实际采用/确认的指针；legacy 应使用记录归属和读取时的值做条件清理。增加 scoped + foreign legacy 同时存在后点击新运行的回归，断言 foreign legacy 不变。

### R3 [P2] 恢复重试在模板/成员请求失败后会错误启用新建表单

- 位置：`apps/client/src/features/collaboration/RunStartWizard.tsx:213-218`，关联 `267-271`、`701`、`756` 行。
- 复现：首次模板/成员加载成功，但旧运行读取失败。此时 template 已保存，restoreFailed=true，输入被正确禁用。用户点击“重试已保存的运行”，initialize 开头先清除 restoreFailed；若这次 getTemplate 或 listMembers 失败，外层 catch 仅设置 toast，保留之前的 template，finally 结束 loading。
- 结果：表单与 Next 重新启用，旧运行尚未恢复；填写后可以调用 createRunDraft 并覆盖 scoped 指针，绕过明确“开始新运行”的选择。
- 修复建议：已存在待恢复指针时，保持失败/待恢复锁定直到恢复成功或用户明确开始新运行；覆盖“首次 run 失败、重试 template/member 失败”的分支。

## 审查证据及边界

- CodeGraph 已先尝试；CLI 回报无可用索引，按提示使用普通源码检索，没有重建索引。
- 核对了列表 API、服务端排序/投影/游标、来源查询与提交 ID/OCC、草稿详情 DTO、草稿更新权限及向导异步序号。
- 没有重跑已报告的 225 客户端、74 服务端、eslint、tsc 等套件；这些属于 task-1-report.md 的实现收据，不冒称本审查重新运行。
- 对两个现有收据未覆盖的分支运行了只读源码函数探针，没有改业务代码、没有启动 UI、没有请求服务端：
  - 从现有源文件提取原 `loadEditableRun`，输入真实服务端投影形状；输出 `restoredStarter:null, restoredTemplate:null, rejectedByNewGuard:false`，确认 R1。
  - 从现有源文件提取原 `initialize`，模拟先 run 请求失败、再模板请求失败；输出由 `restoreFailed:true` 变为 `restoreFailed:false, loading:false, formEnabled:true`，确认 R3。
- R2 为确定性本地存储控制流：scoped 优先读取和 unconditional legacy 删除均直接可见，尚缺实现回归覆盖。

## 尚缺外部验收证据

1. #6：billy 原账号在黄金书屋原小说启动 URL 的真实旧 localStorage/运行记录回放；确认服务端真实状态、明确开始新运行后新旧 run ID、旧记录与内容保持。
2. #5：真实来源弹窗中关键词、同名异路径、多页、无结果，以及桌面/窄屏结果区与选中反馈。
3. #16：原黄金书屋 active/history 显示日期逐项与 createdAt、翻页顺序核对。
4. #17：真实启动向导空名称提交的行内提示和焦点行为。

本审查不操作生产、不做 UI 验收、不创建子代理。上述缺证据不应通过现有测试总数或后续发布收据代替。
