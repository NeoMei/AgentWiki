# 当前目标

- 多页模板填写指南 v0.11.2 已发布部署；六套 41 篇文档的中文与英文正文补齐。已有 7 篇空页面是否补入指南，待用户选择。

# 范围 / 不做

- 新模板包含文档专属提示、表格、示例、完成检查与文档衔接；论文和小说终稿提供完整正文区域。
- 应用 root/server/client 0.11.2；Local Sync 0.10.0、协议 0.6.0、独立 Obsidian 插件 0.5.0 保持。未发布 npm/插件，无 schema 变更，未扩大线上功能开关。

# 当前状态

- master 已合并推送；代码及 tag 59b77ba1 / v0.11.2；生产 https://agentwiki.quukk.com 已更新。
- 模板与流程 19 suites / 288 通过，真实数据库 7 项零跳过覆盖 82 篇创建正文及版本保护；build/runtime contract/typecheck/lint 通过，独立审查无未关闭发现。
- 生产新版及旧版各 82 份正文核对通过，三类文档桌面/手机尺寸渲染与 32 项冒烟通过。原有 7 篇空页面正文和更新时间保持。
- 1078 源码文件匹配，734 旧资源保留；服务 active/NRestarts0、health 全 ok、迁移及两个 env 不变；247 有效页面搜索与向量正常。
- v0.11.1 新建内容导航页继续有效；Space 自定义模板的保存/版本/复用能力保留为“空间自定义”来源。

# 稳定约束

- Folder 为目录，Page 承载正文；folderId 为事实源，权限/CAS/treeRevision 保持。
- 模板版本不可变，升级追加版本，不覆盖已有用户页面。
- 主仓路径末尾空格，Git 显式 --work-tree；保留根目录用户脏文件和其他工作树。
- 浏览器隔离 fixture；发布、部署、真实客户端验收独立记录；页面组沿用 Space allowlist。

# 关键索引

- agentwiki/docs/verification/template-guidance-v0112-release.md
- tasks/archive/template-guidance-20260910/brief.md
- tasks/archive/template-guidance-20260910/decisions.md
- tasks/archive/template-guidance-20260910/refs.md
- agentwiki/docs/verification/new-content-v0111-release.md
- 私有证据：/Users/neomei/.codex/recovery/agentwiki-template-guidance-20260910/

# 风险 / 下一步

- 如用户选择补入现有 7 篇指南，须再次核对正文和更新时间，跳过新编辑并保留可回退版本；目前未修改。
- 本轮未重新验收 Windows 原生、真实手机硬件；生产页面组创建受既有 allowlist 限制，实际实例化在隔离数据库验证。
- 配对备份 /var/backups/agentwiki/template-guidance-v0112.QekvE5；前版 /root/agentwiki-previous-20260910044041。恢复须匹配数据库/附件/应用/env/systemd。
