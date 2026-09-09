# Web 新建内容导航页 v0.11.1 发布验收

日期：2026-09-10。应用 root/server/client 0.11.1 已合并 master、推送并部署至 https://agentwiki.quukk.com。

- 功能提交：56601185；版本提交与发布 tag：8525a350 / v0.11.1。
- GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.11.1。
- 独立 /spaces/:id/new 替代新建弹窗，包含空白直建、单页模板与页面组分类、搜索、来源筛选、目录继承、未提交保护和底部操作栏。
- Local Sync 保持 0.10.0、sync protocol 保持 0.6.0；未发布 npm 包或独立 Obsidian 插件。本次无迁移、权限协议或同步逻辑变更。

## 发布检查

| 检查 | 结果 |
| --- | --- |
| runtime 非数据库 | 263 通过，1 个显式 CodeGraph 验收门禁未启用 |
| runtime 数据库 | 207 项覆盖通过，0 跳过；初始化失败项在补齐专用 Markdown 库 vector 后重跑闭环 |
| server | 151 suites；2605 通过，1 Windows 原生跳过；含3项真实接入测试 |
| client | 106 files / 1458 通过 |
| sync protocol | 10 files / 140 通过 |
| Local Sync | 65 files / 924 通过，1 Windows ACL 跳过 |
| build / typecheck / lint | 全部通过 |
| 生产 API 冒烟 | 32 项通过，测试资源按正常删除接口清理 |

前端 initial JavaScript 498799 / 550000 bytes，PageEditor 466267 / 500000 bytes；保留已有 Mermaid 完整解析器预算例外和可见构建提醒。未放宽任何预算或产品断言。

本次验收环境修正均保留初轮失败日志：测试 NODE_ENV 误传入生产构建；独立 Markdown 库缺少 vector；接入测试要求 connection_ux_server_test_ 库名前缀及 LOCAL_SYNC_PACKAGE_VERSION 配置。补齐私有测试运行器配置后仅重跑受影响范围。浏览器初轮因为目录与主区域各有一个新建按钮造成定位歧义，改为定位主区域入口后通过。

## 生产与浏览器

- 部署文件 1073 个 SHA-256 全部匹配候选；root/server/client 0.11.1。
- 637 个旧静态资源哈希全部保留。部署前打开的旧标签页在升级后可继续打开正文；当前版本编辑器亦正常加载。
- API、worker、frontend 全部 active，NRestarts=0；health 的 database、redis、auditPersistence、attachmentStorage 全部 ok。
- 56 条成功迁移无变化，原有58条迁移历史记录完整保留，无 pending migrations；两个 env 文件逐字节不变。
- Chrome 1440x1000 和390x844实际公网后端验收：空白创建进入编辑器；搜索空间自定义模板、创建到指定目录、回读正文和sourceTemplateId/folderId一致；底部按钮在视口内，无横向溢出及控制台错误。
- 页面组沿用既有 Space allowlist。测试 Space 未开放，线上正确显示限制；页面组创建本轮使用本地隔离接口及既有真实数据库回归验证，未扩大生产开关。
- 验收账号、Space按应用删除接口清理；保留应用既有软删除历史。原有239个有效页面仍全部拥有正确搜索文档和向量，missing/stale均为0。

## Space 模板结论

功能仍支持保存、版本与复用，已通过真实后端和浏览器验证，因此保留为“空间自定义”来源。

须排除已删除Space统计：生产当前有效Space中，未归档自定义模板0个，已有历史模板版本1个，现存页面引用0个。初步全表统计的1个未归档模板、3个版本包含已删除Space，不能用作活跃使用证据。本次不删除用户模板或历史数据。

## 恢复与证据

- 验证过的配对备份：/var/backups/agentwiki/new-content-v0111.dkQVlq。
- 前版应用：/root/agentwiki-previous-20260910034200。
- 远端工具：/root/agentwiki-release-tools-v0111；六个helper已与SHA256SUMS.remote校验一致。
- 回滚必须匹配数据库、附件、应用、env和systemd配对备份，不可单独启动旧应用。本次未执行恢复。
- 私有证据：/Users/neomei/.codex/recovery/agentwiki-new-content-20260910/；含gate日志、运维适配与复审、源码/资源哈希、健康和服务状态、生产smoke与浏览器截图。凭据未纳入Git。
- 原工作区HANDOFF.md逐字节保持；日常Vault安装验收的原未提交备注单独保留。本次独立数据库/Redis容器已停止。
