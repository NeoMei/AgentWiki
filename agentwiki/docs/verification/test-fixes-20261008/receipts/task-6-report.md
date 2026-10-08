# Task 6 实施回执

日期：2026-10-08。状态：候选已实现、自审并提交；等待控制器独立审查。原报告 #2 首次配对案例仍待验。

## 候选身份与范围

- 独立插件 worktree：`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/test-fixes-20261008`
- 分支：`codex/test-fixes-20261008`
- 基线：`ece5544ec3e33f53f79705060077423748c01844`（0.5.6）
- 提交：`e5b8a3a2624b5208d16a656d15ccd194d2805fd7`，`fix(sync): preserve remote descendants of deleted parents`
- 工作区已干净。没有改协议、服务端、依赖版本、生产、真实 Vault 或凭据，没有安装/发布候选插件。

## 实现及用户选择

合法三方树：base 中父目录已同步，本地删除，远端保留父目录并新增目录或页面。现在删除候选记录两侧真实目录位置；保留后代依赖时恢复完整祖先链，生成每个父目录唯一的结构化冲突。预览可打开，不静默丢远端新内容。

- 选择远端保留会应用之前由结构依赖晋升的冲突选择，以实际 local 缺失生成 `create_directory`，按父先子后排序。
- 选择缺失侧删除而仍有后代时抛出 `FOLDER_HAS_DEPENDENTS`，中文提示“目录仍有后代，无法删除；请选择保留目录，或填写新路径移动目录及其后代”。失败保持整个预览和 resolutions 不变；保留或手动新路径都可将 pending 决策降到 0。
- 不提供无提示级联删除。若需要删除整个仍有内容的目录，应另作明确后代处理设计。
- 真正未知父节点、手动目标缺父、路径冲突和目录循环继续拒绝；没有放松校验、生成伪 ID 或把父引用强制置空。

## 文件

1. `src/core/merge.ts`：完整删除候选，两侧位置；应用结构依赖产生的显式决策。
2. `src/application/tree-diff.ts`：远端候选可晋升、冲突去重、删除依赖阻止、实际缺失父目录恢复动作。
3. `tests/unit/tree-diff.test.ts`：V2/V3 remote 新 folder/page、多层祖先、失败不变、远端保留与手动重定位；反方向 local 新后代；首次嵌套 pull；坏父节点拒绝。
4. `tests/integration/sync-runtime.test.ts`：V2/V3 child-first 分页首次嵌套同步、已同步父目录本地删除后恢复、事务真实内存 Vault 回读、既有 local 文件保留及父先子后顺序。

## RED / GREEN

工作目录均为上述独立插件 worktree。

```sh
npm test -- tests/unit/tree-diff.test.ts tests/integration/sync-runtime.test.ts
```

- 初始 RED（20:01:57）：7 failed / 124 passed。6 项父级缺失复现；其中 V2 事务用例的最初 fixture 缺 pages，为测试构造错误，之后已修正，未作为缺口证据。
- 最终 fixture 二次 RED（20:03:51）：临时将两个生产文件还原为 HEAD 基线，最终测试集 7 failed / 126 passed，退出 1；全部 7 项为实际 `UNKNOWN_PARENT`，覆盖 V2/V3 folder/page、多层祖先、手动恢复及两版事务。执行后立即恢复候选生产代码。证据 `/tmp/task6-red-verified.log`。
- Focused GREEN（20:03:31）：2 files / 133 tests passed，退出 0。之后补 V3 手动路径与反向删除选择，用完整 check 验证最终状态。

```sh
npm run check
```

最终 GREEN（20:04:51）：退出 0，格式、lint（0 errors）、typecheck、69 files / 1418 tests、production build、bundle safety、release metadata 均通过。Bundle 1747198 bytes，版本仍 0.5.6。证据 `/tmp/task6-check.log`。

自动建嵌套映射目录能力未重复实现；现有 `mapping-folder.test.ts` 8 项和 `obsidian-adapters.test.ts` 46 项通过，含嵌套建父、目录复用、文件占位、创建/保存失败及真实插件入口。分页验证使用固定元数据的多页假远端，将页面、子目录置于父目录之前；实际 snapshot reader 与 runtime 完整执行。

自审：`git diff --check` 通过；删除依赖失败后的预览未变；两版保留/手动决策可退出；实际事务恢复且本地 Keep.md 未变。未派子代理；独立审查由控制器进行。

## concerns / 原案边界

- 原测试者“手动配对→映射空间→首次自动合并”未复现；不能把本次有 baseline 的合法边界修复当作原案已闭环。
- Windows、真实 Obsidian GUI 和真实 Vault 未覆盖。本轮是隔离内存 Vault 的运行时/事务回读，不能表述为原生验收。
- 原案仍需实际 manifest/bundle 身份、operation/phase/stack、协议与 baseline 状态、脱敏 base/local/remote ID/parent/path 结构；不需要正文或令牌。
- lint 有 19 条既有告警，全部位于未改文件；无新增告警。npm ci 已完成，安装 audit 10 项为控制器给定基线，本轮未自动 upgrade；此次实现没有新增依赖或网络/凭据表面。
- UNKNOWN_PARENT 全局用户提示目前仍建议选择已有父目录；诊断中提出的上下文区分为后续提示改进，本次未扩展范围。

历史线索仅用于知道 0.5.6 映射自动建目录已有能力，已由当前代码和完整测试独立确认。全局 MEMORY.md:1353，rollout 01a0cdaa-ce6e-7d61-b480-d4c7a3e9c32e。
