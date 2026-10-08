# Windows 包管理器包装器补丁独审

日期：2026-10-09。范围仅 `agentwiki/scripts/package-manager-process.mjs` 与对应测试。独立审查结论 **PASS，无必修项**；随后真实 Windows 同一文本补丁 17/17 通过。

- 正式 v0.12.17 在 Windows 的 3 项进程测试传入 Node 绝对路径或不存在的可执行路径，原 resolver 无条件访问包管理器表，提前抛出 `undefined.map`。
- 最小修复以 `Object.hasOwn(WINDOWS_ENTRYPOINTS, manager)` 限制 Windows 特殊解析；npm/npx/pnpm 保留原有 JS 入口转换，其余路径和参数透传，无新增 shell。
- 实现者为 forced-win32 回归先取得同样失败，再修复通过。独立审查另行执行两份测试 17/17，0 fail/skip；额外核查含空格绝对路径、未知命令、原型键和参数原引用，三种包管理器仍转换、无入口仍抛错。
- 独审 `git diff --check` 通过，未修改被审文件。
- 实现 SHA256：`d7acea59b970af80b95742e8f93b56bb774a18738d410685afcaeaea70ba5c01`。
- 测试 SHA256：`2c6e73834ef68c1f1b9cdf26cf7592323460e99ea32151c1e2b24b5f418837ee`。
- 补丁 SHA256：`37929aef9dad26e498d79ccf118041e1c7ed59fc5a216b9b52c4347594d471bc`。

真实 Windows 回执为 `exec-ed7e5c9f-b6c0-4723-9ef5-23547fe3706c`，17/17、0 fail/skip，exit 0；包含实际超时进程树终止、ENOENT 保留和成功时及时返回。Windows CRLF 文件经 LF 归一后的上述两项 SHA256 均精确匹配，回执 `exec-3ecf79f1-335f-49dd-895c-7fe53bbe7566`。

这份审查不涉及 Local Sync journal 的旧 EPERM 失败或 Obsidian 原生同步。Windows 源码修复不改写已发布 v0.12.17 tag，也不代表重新部署网页。
