<!-- codex-memory:template=task-brief:v1 -->

# local-knowledge-sync

## 目标

实现零配置 Local Knowledge Orchestrator：从 codebase-memory、MarkItDown 和未来 agent-memory 等 Adapter 获取本地整理材料，由当前本地 Agent 按稳定协议生成统一 Space Wiki，并与 AgentWiki 权威版本库进行确认门禁下的双向同步。

## 当前状态

- `@neomei/agentwiki-local-sync@0.1.1` 已发布；OKF evidence 和 OpenCode timeout 修复已完成。
- 真实验证确认 OpenWiki 过重且不稳定，旧 OpenWiki 必需链路被新设计取代。
- 用户已逐项确认本地整理、Agent 执行语义工作、确定性状态机/Recipe、Space 统一 Wiki、私有 Adapter runtime、服务端权威 Revision、双向同步与三方合并。
- 新设计已写入 `agentwiki/docs/superpowers/specs/2026-07-30-zero-config-local-knowledge-orchestrator-design.md`，并已得到用户确认。
- `0.2.0` 总路线图与四份顺序实施计划已经完成并自审；下一步从本地协议、原子 Workspace、Recipe/校验和状态机开始执行。旧三份 OpenWiki 计划仅保留历史参考。

## 范围

- Source Adapter 协议：codebase-memory、MarkItDown、agent-memory 和未来 Adapter。
- `@neomei/agentwiki-local-sync` Agent Skill、stdio MCP、CLI、Local Knowledge Orchestrator 和 Adapter Manager。
- AgentWiki 生成固定版本接入指令和 10 分钟单次安装码。
- 本地状态机、版本化 Recipe、Schema、provenance、checkpoint、preview 和明确确认。
- 同一 Space 统一 Wiki、本地文件物化、服务端 Snapshot/Delta/Revision 和跨机器双向同步。
- base/local/remote 三方冲突合并提案。
- 代码、Markdown/TXT/PDF/DOCX 和未来可共享 Agent Memory。

## 不做

- 服务端读取本地路径。
- 上传原始代码库、原始二进制文件、原始 Agent Memory 数据库或本地凭据。
- OpenWiki、独立本地模型或全服共享模型作为必需整理引擎。
- Source Adapter 直接写 Wiki、同步、审批或发布。
- P2P/CRDT 多主同步、last-write-wins、后台 daemon 或第一阶段实时文件监听。
- 仅靠提示词约束的自由工作流。
