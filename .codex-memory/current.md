# 当前目标

- 内置模板与协作页面 Plane 风格改版完成，已按用户授权发布 GitHub 和服务器。

# 范围 / 不做

- 模板目录、预览、协作配置/启动、模板管理、运行面板、任务看板及文档排版已上线。
- 本次未发布 npm 或独立 Obsidian 插件；保留用户正文与模板历史版本。

# 当前状态

- AgentWiki v0.12.19 已正式发布。tag/部署源码 `654731b15d507c4defa24ef82f0708eb178b5a07`，root/server/client均0.12.19；master包含发布提交，后续仅补文档回执。
- 三轮改版审查与独立发布复核关闭全部本期问题；精确发布提交6995测试通过、6既有跳过、0失败，数据库230零跳过；全仓构建/typecheck/lint通过。
- 1240服务器文件哈希匹配，三个服务running/0重启，内外五项健康ok，公网32项烟测及自有资源清理通过；环境文件哈希不变。
- Chrome正式登录环境模板/启动/阅读页面桌面及390px验收通过。浏览器未保存正文或启动Agent。
- 配套数据库/附件/应用备份核验完成，旧应用保留。具体位置与回执见关键索引。

# 稳定约束

- 仓库路径末尾空格，worktree Git显式--work-tree，不改共享core.worktree。
- 原检出及其未提交资料保持；原分支codex/assist-qwen-fallback未切换。
- 本地测试、生产烟测、浏览器读验和真实Agent执行分别记录；本轮没有触发真实Agent执行。

# 关键索引

- GitHub：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.19
- 正式站点：https://agentwiki.quukk.com
- agentwiki/docs/verification/template-layout-v01219-release.md
- .codex-memory/tasks/archive/template-layout-plane-20261013/{brief,decisions,refs}.md
- 工作树：`/Users/neomei/.codex/worktrees/template-layout-plane/AgentWiki `。

# 风险 / 下一步

- 本轮改版与发布已完成，无待执行发布步骤。6条平台/独立门禁skip仍按回执保留，不表述为全平台全通过。
- 保留已核验备份和旧应用；后续回滚须匹配数据库与附件快照。
