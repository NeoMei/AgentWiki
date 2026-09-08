# AgentWiki 主仓与生产代码对齐（2026-09-08）

## 整合范围

运行代码冻结于 `287bcd803d52cf1153fe446fe4d681db58ed1652`。GitHub master 原为 `975c1dd4033f045ca988646476e2c6292d6a2779`，本地主仓 master 原为 `b776b8304d14070255583f0ed064b6d86905e528`，两者均是冻结提交的祖先，可快进整合。独立工作树 `/Users/neomei/.codex/worktrees/server-source-align-20260908` 从远端主分支建立，再快进到已部署解析器分支。

补入远端主分支的四个提交只修改六个服务端源码/测试/样例文件：完整等长反引号 code span 匹配、按长度索引避免重复扫描，以及 bundled OpenCode 测试隔离与失败清理。没有修改依赖、版本号、数据库迁移、插件包或其他任务中的产品代码。本地较旧主分支同时接收远端已有的相对图片与 legacy 同步修正。

## 新运行的验证

- 原远端基线解析器：114 tests PASS。
- 冻结候选：服务端 build、typecheck、lint 均 exit 0。
- 专用本地 PostgreSQL/Redis 上的完整 server harness：148 suites、2570 tests PASS，1 Windows-only skip，exit 0。随机测试 schema 清理后为 0，public tables 为 0。
- 完整前端：94 files、1292 tests PASS，exit 0。
- 独立六文件代码审查：Critical/Important/Minor = 0/0/0；`git diff --check` 通过。审查者不承担生产或真实 Vault 验收。
- 首次 server harness 在测试前因新建测试数据库尚未启用 vector 扩展而失败；仅在本次专用测试库中补齐扩展后重新运行完整门。失败日志与最终通过日志分别保留，不将预检失败算作通过。

## 生产只读核验

SSH 到实际生产 `/root/agentwiki`，按候选 Git 对象内容逐文件 SHA-256 比对：1038 个候选部署相关文件中，1032 个在生产存在并全部相同，无内容差异。另 6 个仓库文件不在生产目录：`.env.example`、`.gitignore`、`.node-version`、`.pnpm-config.json`、`docker-compose.yml`、`eslint.config.mjs`。

本次干净构建产生的全部 238 个服务端 `.js` 与生产 dist 逐字节匹配，无缺失或差异。包括：

- parser 源码：`db576792ffce5f829092e0de0f0ac745ae23db6165af233ae5a8c661a57ce967`。
- parser 编译 JS：`a54d1e3df58f9ec618f77c07411d5f19ba23d5c330886f330c22fef7d0894ed8`。

服务由 root 的 **user systemd** 管理，必须使用 `systemctl --user`；系统级同名 unit 不存在，不能据系统级查询判定服务停止。API、worker、frontend 均 active/running，NRestarts = 0；内网和公网 health 的五项状态均 ok。

因此服务器已经运行本次整合候选，无需再次复制文件、停服重建或执行迁移；本轮没有生产写入。生产目录无 Git 元数据，不将文件核验表述为生产 Git HEAD。本轮没有重新执行真实 Vault 写入或全套公网同步验收；同一部署代码的既有正式包验收见插件项目记录。

## 分支、版本与证据

主分支同步包含本记录等文档提交；产品代码冻结仍为上述 `287bcd80`。服务端、客户端、Local Sync 版本保持 0.9.1。已有 `v0.9.1` 发布标签和 npm 包不改写，本次对齐的是 GitHub master 与本地主仓。独立 Obsidian 插件正式版 0.4.0 不变。

私有本地证据目录：`/Users/neomei/.codex/recovery/agentwiki-source-align-20260908/`，含逐文件源码比对、238 项编译产物比对、各测试日志及主目录原有文件保护清单。服务器保持先前部署备份，其他任务工作树和主目录未提交文件保留。最终 Git 分支哈希及用户文件复核写入该目录的 `final-verification.json`。
