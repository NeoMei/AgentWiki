# 可追踪来源的复核与更新

用户已批准《能力增益筛选》的第二个核心方向。本期只覆盖同一 OKF sourceKey 的再次同步，以及直接绑定该 Source 的页面。其他来源、间接语义依赖和外部仓库变更不声称已覆盖。

## 行为

1. 经过现有上传确认、身份和内容校验的新 OKF 输入成为当前已接收来源。正式页面保持不变，直接关联页面在读页及返回正文的检索/列表中标记需要复核。
2. 既有 ingestion 生成 ChangeSet，人工逐项审阅并发布后，相应页面才与当前来源一致。拒绝、只接受部分项或仅生成候选不会把剩余页面标为已复核。
3. 当前只表示页面的来源版本及输入代次已经审阅对应，不表示事实绝对正确，也不表示刚刚检查了外部系统。
4. 新来源又发生变化时，旧 worker 不得产生可发布的新候选；已经批准的旧候选也不得发布。现有页面/目录版本冲突校验继续生效。
5. 原始来源和旧证据保留可追溯。旧证据明确标为历史；无权访问、跨 Space 损坏关联和失效凭据不泄露来源正文、摘要、配置或跳转信息。

## 最小持久化契约

- Source.currentSourceVersionId nullable；Source.currentSourceGeneration 非负 Int、默认0。
- IngestRun.inputSourceGeneration nullable；Page.sourceGeneration nullable。历史记录不猜测、不回填为当前。
- 当前输入指针建立于受验 intake 事务；worker 从不推进 head。版本号是内容版本，generation 是接受顺序，不能互代。
- A→B→A 复用 A 的 SourceVersion，但代次递增；旧 A 候选失效，旧 A 页面仍待复核。相同当前输入不增代。重放同幂等键只返回原请求，不改变 head。
- 每个成功 intake（包括同内容 existing/noop）都持久化幂等回执，不能只靠新建 Run 的唯一键。增加 SourceSyncReceipt，按 sourceId/idempotencyKey 唯一，固定输入hash、version/generation及原始返回结果；回执与head/Run同事务。A/K1→同A/K2→B/K3→重放K2不能倒退head；同key异内容明确冲突。历史已有Run键仍可重放，缺失的历史noop键不伪造回执。
- SourceVersion 必须属于 Source；Source 必须属于输入/页面/ChangeSet 的 Space。普通 FK 加统一锁内校验、公开读取再次核对归属；不信任单独外键。
- head 外键删除置空后 generation 可以保留正值，公开结果为 unknown；因此不得增加“head=null必须generation=0”的约束。head非空时generation必须为正；Run/Page非空代次必须为正。递增达到 Int 上限时显式拒绝。

## 事务和候选

沿用身份→Space advisory→Space→Source 的锁顺序，多 Source 按 ID 排序；不能先锁 Space 行再取 advisory。SourceVersion、head与固定输入Run在同一事务提交。

human intake/worker分支必须先锁当前User/PAT身份，再获取Space advisory/行锁，锁内重验成员与凭据；Agent跨边界helper的human分支不代办这些检查，不能直接替换后漏验。

候选 create/update/archive payload 均携带 sourceId/sourceVersionId/sourceGeneration；与所属 Run 的固定输入一致。worker建候选和最终发布时检查活动来源、归属及当前代次。发布校验在写 Page/Approval 之前，任何一项失败整笔回滚。来源关联的其他候选同样由所属 Run 的当前输入检查保护。

带输入代次的 OKF ChangeSet 一律人工审阅；即使 publisher/scoped-auto-publish 也不自动发布该切片。发布入口再次限制自动发布上下文。历史未追踪来源保持 unknown；一旦建立 head，缺代次的旧候选必须重新生成。

既有 Sources“运行”操作为当前已验证 head 固定新 Run，用于拒绝或冲突后重新生成；retry保留原代次，不能静默升级过期 Run。

## 编辑、回滚与来源状态

- source-bound 页面的人工正文/format实际更改（不是仅提交同值字段）、Local Sync/Obsidian写回、普通或协作提案修改、附件链接重写及恢复 PageVersion 清 sourceGeneration，保留旧来源与证据；纯标题或位置修改可保留代次。只有已在锁内校验固定Run输入的ingestion发布能赋予新代次，客户端payload不能自报已复核。
- ChangeSet revert 精确恢复 before 的 sourceGeneration；旧 before 缺字段恢复null，不动 Source head。
- archive来源保留head和证据，但返回 unavailable并阻止worker/publication。reactivate只恢复与原已验证head的比较，不增加输入代次，也不宣称检查了外部变化。

## 读取和界面

统一最小 DTO：status为untracked/unknown/unavailable/needs_review/current；受权时附sourceId、页面和当前版本ID/版本号、页面和当前代次及具体原因。无权或损坏关联只返回通用unavailable，不带来源标识。无直接来源的人工页面为untracked。

REST读页、MCP get_page/page resource，以及返回正文的REST/MCP搜索与列表均携带该状态；用批量投影避免逐页读取。get_page证据改为明确字段白名单，保留必要quote/location/版本/有限文件路径，移除完整SourceVersion.content和任意metadata/config；每条来源分别实时授权并核对Space。历史证据按已发布依据与Run输入代次标记，不把A旧代次当成当前依据。

PagePreview在待复核时给可见提示；PageInfoPanel显示版本差异和历史依据；ReviewPage显示当前候选与当前来源是否一致，复用既有审批入口，不新增评分页或审批系统。审批/发布仍由服务器决定，UI状态不是锁。

## 验收

独立隔离构建，真实DB+现有API/MCP与UI，固定每阶段commit及数据快照。v1发布→v2输入→关联页待复核但正文不变→Agent识别旧结论→人工部分审阅/发布→另一个新Agent读到新结论且能查旧依据。无关页面不误标。另测A→B→A、相同输入并发、v3抢先、人工改稿、恢复/回滚、来源archive和权限撤销。

真实Agent必须经实际工具读取后回答；fixture仅用于固定来源内容。结构测试、实际UI、真实provider和部署分别报告。additive迁移先独立审查再更新已审核corpus digest，保留隔离schema和库存保护。无生产迁移、push、merge、发布或部署。
