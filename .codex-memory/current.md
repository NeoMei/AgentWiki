# 当前目标

- Obsidian 与 Agent 接入体验改造、真实客户端成功路径验收、正式发布及生产部署已完成。

# 范围 / 不做

- Obsidian 默认浏览器授权；手动连接码保留为有用途与期限说明的后备入口。Agent 使用可恢复分步JSON接入，基础连接与知识导入分离。
- 已发布应用0.11.0、Local Sync0.10.0、独立插件0.5.0。主仓协议0.6.0、插件协议依赖0.5.1保持不变；无新增schema迁移。
- 保留旧NDJSON/human/--code及LocalSync0.9.0/0.9.1兼容。日常Vault、用户Agent配置与用户知识未改。

# 当前状态

- 主仓master及v0.11.0标签已发布，标签fb632410；运行代码16db7cfd。独立插件main/0.5.0为5751424，GitHub发布CI、正式三资产哈希和main.js attestation验证通过。
- 主仓最终完整各阶段5588通过/3明确跳过，typecheck/lint/build通过；插件完整check1353通过，17条基线lint warning。默认并行/短测试预算的历史失败和最终完整阶段复验保留于发布记录。
- 生产0.11.0部署完成，API/Worker/Frontend active且NRestarts=0；health五项ok、API烟测32通过。1423部署文件无漂移，前版542静态资产保留；env仅LocalSync版本变更，56成功迁移历史不变。239活跃页与搜索索引健康保持。
- npm正式0.10.0隔离缓存全新安装159文件一致；生产接入实际完成全部分步状态，加载27工具/21远程wiki工具，SDK真实wiki_get_page读回正确标题与标记，测试账号/Agent/Space已清理。
- Obsidian专用Vault候选真实浏览器授权、映射、拉取、正文读回和插件重载恢复通过；官方发布三资产与该验收版本一致。用户回传OpenCode实际agentwiki_wiki_get_page正确标题/标记，宿主验收通过。先前Codex宿主审批失败保留，不改记通过。
- 生产网页新旧标签页导航、Obsidian默认入口/手动后备，以及OpenCode固定0.10.0分步提示词已用Computer Use确认。完整证据见发布记录。

# 稳定约束

- Folder为目录，Page承载正文，folderId为事实源；权限、CAS、treeRevision与同步协议保持。
- 主仓路径末尾空格；Git在仓库根显式--work-tree。保留原HANDOFF、历史失败证据、其他工作树及日常Vault。
- 发布、部署、实际宿主读取和本地日常安装是独立证据；不混淆公开正式包SDK验证与用户回传真实OpenCode验证。

# 关键索引

- agentwiki/docs/verification/connection-ux-v0110-release.md
- agentwiki/docs/verification/connection-ux-candidate-20260909.md
- tasks/archive/connection-ux-20260909/brief.md
- .superpowers/sdd/2026-09-09-connection-ux/
- 私有证据：/Users/neomei/.codex/recovery/agentwiki-connection-ux-20260909/

# 风险 / 下一步

- 本轮发布完成，无已知发布阻塞。日常Vault尚未自动更新；候选专用Vault与官方资产一致性已验证。
- 配对备份/var/backups/agentwiki/connection-v0110.VRkTfs；前版/root/agentwiki-previous-20260910011607。回滚使用配对数据库、附件、应用、env和systemd，不能单独启动旧应用。
- Windows原生平台与显式CodeGraph门禁的跳过边界、历史认证过期及验证脚本初轮状态断言错误均在发布记录保留。
