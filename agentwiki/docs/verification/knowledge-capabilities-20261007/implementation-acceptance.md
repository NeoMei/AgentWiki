# AgentWiki 知识能力：本地交付与验收

2026-10-07。最终产品候选 `ddfaf538678f95b56724d3f4b79d328e7b24adc2`，分支 `codex/knowledge-capabilities`，基线 `165c207bf4b644efa810ea6c9a3da11d28c4f96e`。本期采用已批准的无收益收缩：**来源复核闭环完成；检索保留工具参数兼容修复，未证明收益的额外指导已撤回。**

## 实际交付

| 项目 | 结果与边界 |
| --- | --- |
| 来源变化与复核 | 同一 OKF sourceKey 重新同步后，直接绑定页面显示待复核，正式正文保持原样；人工逐项决定并发布才更新 |
| 版本和历史 | 显示页面已审依据与当前接收来源的版本/代次；旧证据保留历史标签；A→B→A 不会复活旧候选 |
| 人工改稿与回退 | 正文改动和 PageVersion 恢复清除旧复核证明；精确 ChangeSet 回滚恢复当时记录，Source head 不倒退 |
| 权限 | 实时撤权生效；无来源访问权限时保留独立授权的页面正文，清除来源标识/证据/Run；归档但有权的历史依据仍可读 |
| Agent 工具 | 六个只读工具支持命名参数与 legacy `__args`，拒绝冲突值，保留显式 Space 及凭据边界；没有新检索服务 |
| 未采用 | CodeWiki、自动语义影响分析、额外检索coaching、自动发布、新审批系统 |

## 验收结论分开记录

- **本地实现与独立审查：** 各实施任务、DDL、harness、修复波次均有独立回执；来源后端服务级实际 PostgreSQL 14/14，相关 content-tree 实际 DB 21/21，原失败与修复链保留。UI 修复47组件测试、客户端类型/构建通过，初始包549014/550000；最终skill分发11项与确认后缀逐字节检查通过。完整分支结论见 `whole-branch-review.md`。
- **实际 API / worker / UI：** confirmed OKF→真实worker→浏览器逐项接受/拒绝/发布→Page读回，覆盖部分发布、补齐、过期候选、人工冲突、恢复、回滚、归档及失权。长文18章/7124字符和12列宽表在1280/1600/390实操与独立看图通过。先前已发布提示仍说待审、冲突提示过泛两项已修；一次回滚截图误等筛选标签的缺口另开隔离环境补证，原截图保留。
- **真实模型与fixture：** 来源A/B是两个新native Codex消费者，经实际MCP读取；A正确区分旧正式24小时/7天与待复核来源，B在审核后取得48小时/14天及历史依据。输入为合成资料，OKF pipeline是产品确定性编译，不是假模型回答。requested模型gpt-6-astra/high，服务端resolved模型未披露。
- **检索质量：** 保留所有旧基线/候选/整合/收缩结果。最终A事实完整7/8、B8/8，两者严格逐题引用7/8；不能声明完整质量门禁通过，也不声称成本/速度改善。依已批准fallback撤回未证实策略，仅保留参数可用性修复及来源语义说明。详见 `retrieval-acceptance.md`。
- **ACP、安装、部署：** ACP继续只保留既有接口定义，没有新增完整本机接入。没有push、merge、发布、部署、生产迁移或日常客户端升级。新迁移只应用到自有隔离测试schema。

## 已知范围与证据

受控迟到worker竞争只由服务级真实DB证明，未在实际运行队列中停worker模拟；来源主线graph没有关系边，不能宣称该主线涵盖边Evidence。实际gateway stdio的resources/read返回-32601，服务器既有/api/mcp资源读取通过，二者区分。pages-only PAT是明确标注的隔离权限fixture，非公开scope管理UI。

所有本期runtime、schema、state、IPC会话及已知临时资源均按所有权清理，公共库存digest保持`6191ee0d4c7a10c831beec7d159577e65eba7ba68ae2fcbf6b21e2758c785ea6`。各root外部核验范围按回执记录，不把session自报IPC移除写成所有路径均再次独立核查。旧基线checkout因app归属元数据冲突保留，无运行进程；早期未记录路径的迁移临时bundle没有擅自删除，不宣称整个文件系统无残留。

- 来源实际验收：`source-freshness-acceptance.md` / `source-freshness-result.json`
- 检索各轮及评分：`retrieval-acceptance.md`、`retrieval-result.json`、`retrieval-integrated-result.json`、`retrieval-scoped-result.json`
- 实际私有证据：`/tmp/agentwiki-knowledge-20261007`；不提交凭据、原始完整DTO或模型提示中的私有state内容。
