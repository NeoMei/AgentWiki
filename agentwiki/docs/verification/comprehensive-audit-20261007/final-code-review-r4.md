# 最终相邻读取闭环 R4

结论：本轮限定读取范围无新增值得修复 finding。R3/F5 已代码修复并获独立 APPROVE、20/20 单测通过；新构建 REST/server MCP GREEN 仍待 root，不提前关闭实际验收。

本轮只读检查 knowledge-sync.service.ts 的 getState、findReceipt、findConcurrentWinner，knowledge-sync.controller.ts 的 GET/POST 分界，mcp.service.ts 的 get_knowledge_sync_state，SourceService list/get 与 coherentRunReads。无运行服务、DB、浏览器、构建或产品修改。

getState 是公开同步状态只读入口；REST/MCP 均共享已修服务，没有另一条绕过 getState 的公开 receipt GET。请求来源按 Space+type+sourceKey 定位，Run/输入 Version 的归属过滤与回验已覆盖，旧合法 completed/partial 输入无 head 限制。

Source list 只返回 Source 自身字段和关联数量；get 的 versions 是 Source 反向归属查询，runs 经过共同 guard 后才投影。没有发现另一条展开外 SourceVersion 文件路径/hash/内容的状态旁路。原有 Source 自身标量标识不等价于跨关系展开，本文不声称任意手工损坏的所有标量都经过通用数据库完整性校验。

findReceipt 是私有 createSync 写入/幂等重放分支，并非 GET/MCP 状态读取。其输出为 receipt 中既存 sourceVersionId/runId 与状态，不展开文件/版本正文；legacy 分支校验输入 Source/hash。该路径经过确切来源/idempotencyKey/inputHash 和调用方写授权/锁。本轮未把人为篡改 receipt 标量的假设升级为新写协议改造，不宣称通用 receipt 损坏防护已经实现。F1 确切历史 receipt 优先于 metadata update 的顺序不变。

边界：这是 F5 相邻读取收口，不是新一轮整库安全审计或所有脏数据库组合的证明；不复验此前 whole-branch/R3 覆盖内容。剩余验收仅按 root 已安排的新构建 REST/MCP GREEN、相关 local-sync 浏览器回归与清理完成。
