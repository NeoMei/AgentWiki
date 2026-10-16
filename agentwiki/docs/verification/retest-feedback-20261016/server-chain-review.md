# 独立审查：普通首次 v2 边界兼容

- 审查固定 HEAD：`021571863d78932174f7265b33f9ed169b3024a9`。
- 比较基线：`264c64fd`；产品提交：`65e91103`。
- 范围：1 个产品文件、2 个测试文件；额外只读检查 reader、writer、retention 调用路径。
- 结论：**PASS，未发现本次补丁引入的阻断性正确性或安全问题。**

## 审查依据

新增逻辑只在没有 checkpoint、没有 Task 6 migration genesis 且原严格全链校验失败时执行。普通首次 v2 需满足受支持 writer origin、无 migrationBatchId、无附件；其精确同 Space 前驱必须仍保留。保留 legacy 段必须是连续 knowledge-bundle@1/none，所有仍保留历史的 schema/recipe、migration marker、sidecar、Folder、已放置 Page、tree delta 均参与旧 v2 证据拒绝。最早缺失父行必须物理不存在，指向其他 Space 或仍存在行不会成为合法截断。

选定 first v2 后，完整快照路径、正文 hash/字节数、revision hash、page/manifest/body 计数、sidecar metadata 和从空树计算的精确 full-upsert delta 继续验证；最新 revision 到该边界的每个序号及 parent identity 仍需连续一致。完整链、已有 checkpoint、正式 migration genesis 的原有分支未放宽。没有数据库写入、重建基线、补伪造 checkpoint 或修改历史内容的新增路径。

新增测试含真实 Prisma DB head/snapshot/delta/space listing 且读取前后 revision 行保持一致，并在同计数 delta 篡改后拒绝；单元负例覆盖缺前驱、错父、跨 Space、旧 v2 各类证据、错误 migration 标记、legacy 空洞、坏 hash/正文/full delta、缺 v2 祖先。未发现测试仅凭 mock 掩盖此次新增查询的情况。

## 范围和非阻断限制

- 本审查为独立静态审查；主代理独占运行 test:full，本审查未执行测试、构建或访问共享 DB。实现者与主代理的运行结果需分别记录，不能记为本审查执行结果。
- 普通首次 v2 的完整快照每次进入该兼容分支会额外验证一次；开销与 first v2 快照大小及 retained legacy 数量有关，使用集合查询，没有逐 revision 的 DB 查询新增。当前目标生产链规模未显示阻断性风险。
- 既有 RevisionRetentionService.assertV2GenesisTransition 仍只信任 Task 6 migration genesis（或 sequence 1）。这类 ordinary cutover 若进入过期清理会保守报 REVISION_RETENTION_UNTRUSTED_V2_GENESIS，继续保留历史。该拒绝在本补丁前已经存在，本次未改变 retention；它不会静默删掉此次必须保留的 legacy 前驱。不应把本次读链修复描述为已完成该类历史的 retention 兼容。

审查未修改产品、测试、构建产物或数据库。
