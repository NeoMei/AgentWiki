# 天枢官网名称更新（2026-10-25）

用户确认 AgentWiki 官网 https://agentwiki.quukk.com/ 作为「天枢」的官网。本次只更新前端品牌与介绍，中文显示「天枢 · AgentWiki」，英文显示「Tianshu · AgentWiki」。AgentWiki 继续作为技术标识；API、MCP、包名、域名、角色和业务内容不变。

## 源码与验证

- canonical 分支：`codex/agent-autochat-external-opencode`；源提交 `f92889daa5b1f47abfb3a83ef1572bd27b13ee3b`，基线 `24fbbb04`；Web/API 仍为 0.12.59，未新发 GitHub Release/npm。
- release guard 与 diff check 通过。
- 6 个相关测试文件、70 项测试通过；TypeScript + Vite client build 通过，初始 JS 550844/551000 bytes。既有 Mermaid 循环 chunk/大型惰性 parser 提示仍存在，未调整预算。
- 本地 CUA：320px 中英文首页/指南与390px中文首页无横向溢出；修复指南英文品牌与导航相挤、语言按钮中文换行。桌面首页与导航实见。
- 生产 CUA：中文首页、英文首页、切换语言后刷新保持英文及标题、工作台品牌与1024/390px宽度、390px中文首页均通过。未提交登录/注册表单或修改业务页面。

## 发布与回滚证据

- 生产基线部署范围1425源码文件已逐项SHA-256核对；本次14个修改文件在写入前再次校验基线。
- 配对应用/配置/PostgreSQL custom-format/附件备份：`/var/backups/agentwiki/tianshu-brand.l5LrYtAk`。应用归档内容、pg_restore目录、附件live-before/副本/live-after/recheck清单、8项SHA256SUMS均通过；API/Worker暂停备份后已恢复。
- 定向更新14个前端源文件与405个构建文件，保留7629个旧immutable assets以兼容已打开标签；仅前端服务为本次换包重启，无迁移、安装或Nginx改动。
- 旧前端：`/root/agentwiki/apps/client/dist.before-tianshu-f92889da`；旧修改源文件：`/root/agentwiki-tianshu-f92889da/rollback-source/`。这是前端补丁，常规回滚仅恢复对应源文件/dist并重启frontend；不要为前端回滚恢复数据库。
- 生产14源码/405构建文件SHA一致，公网HTML与本地产物完全一致，5个入口资源SHA一致；API/Worker/Frontend均active，本地和公网health五项全ok。
- 精确部署清单：`deployed-manifest.json`；线上截图：`production-home.png`、`production-mobile.png`。
