# 10-08修复正式发布与部署

状态：网页 **0.12.17已发布并部署**；独立插件 **0.5.8已正式发布**，未安装日常Vault。用户在本地候选验收后明确要求“那就发布啊”，因此本阶段已有直接发布授权。

## 发布身份

- 网页：[v0.12.17](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.17)，发布源码/tag解引用 `4d88ee2bb3af706050f5d88e038b7faf57ea0f2e`；远端master快进至同一提交，无强推。之后补充的交付记录不改变发布tag和运行源码。
- 插件：[0.5.8](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.8)，main/数字tag均为 `b9be0afa667e216c87a15f983431109f79b5ca39`；源分支、main、tag CI 及 Release 工作流全部成功，三个正式资产各自 SHA256、release digest 和 attestation 精确匹配源码/tag/Release run。详见 [独立发布复核](receipts/plugin-0.5.8-release-verification.json)。0.5.7 是此前正式版本，其回执保留在 JSON 的 previousPluginRelease。
- Local Sync 0.11.0、协议0.6.1保持，不发npm；没有新增迁移。

## 精确发布提交验证

网页4d88ee2b重新执行完整test/typecheck/lint/build：6952通过、0失败、6跳过；runtime数据库230项零跳过。六条跳过仍为2条Windows原生、1条独立CodeGraph验收、3条专用连接授权门禁。类型检查和构建通过；lint0error/3既有warning，首屏542577/550000字节。发布元数据独审C/I/M=0/0/0。插件0.5.8最终全套70文件/1422测试通过，格式/类型/构建/bundle/发布元数据门禁通过，lint0error/19既有warning。修复V3摘要取静态快照，以及V2冲突选择未即时校验/摘要滞后；均独立审查通过。原始最终门禁见 [check log](receipts/plugin-0.5.8-final-check.log)。Windows正式0.5.7真实同步先复现问题，0.5.8发布后安装正式资产继续验收；不将发布先后写成原生冲突全通过后才发布。

## 生产回读

2026-10-08北京时间22:28：

- API、Worker、Frontend均active；内网和公网健康检查status/database/redis/auditPersistence/attachmentStorage五项ok，公网使用默认TLS校验。
- 1232个受版本控制的部署文件逐个SHA256匹配发布提交；三应用包实际0.12.17。
- 35项既有环境配置在部署前后指纹一致，不输出配置值；迁移器确认No pending migrations。
- 公网新入口 `/assets/index-RwTQtjfg.js` HTTP200且匹配生产构建；旧入口 `/assets/index-dCB6JZ7J.js`仍HTTP200，避免旧标签页资源失效。
- 真实浏览器刷新首页后读到新入口资源，点击使用指南正常显示，无console error。此会话未登录，不能称本轮生产已重跑全部需登录的15项场景。功能路径以此前真实本地API/Chrome、生产构建fixture和独审证据为准。
- 原恢复旧页3300a11b-0daf-4617-8e4c-ff008e069b85仍存在且未删除，未再次执行恢复脚本。

## 备份与保留

配套数据库、应用及附件备份在 `/var/backups/agentwiki/test-fixes-v01217.ysaZtxag`：数据库29,852,532字节，应用346,923,080字节，附件3,277,708字节；TOC及两份归档均验证，校验值见backup-checksums.txt。旧完整应用保留于 `/root/agentwiki-previous-20261008222652`。未清理备份或工作树，未覆盖主检出未提交的研究资料。本轮临时Redis6392已保存关闭，生产SSH复用连接已退出；既有PostgreSQL与日常Obsidian保留。

Windows 0.5.7 已完成真实双向同步、V2父目录冲突恢复/手动改路径及V3图片协议升级；0.5.8已在Windows正式包完成真实连接/映射、双向正文同步、V2父目录即时拦截与恢复、V2/V3手动目录预览及迁移、图片升级和最终V3零差异；迁移页面与Keep两端SHA一致，合成Space删除后404、设备凭据撤销204、账号删除后旧JWT401，本地证据目录保留，详见 [原生回执](receipts/windows-live-sync-20261009.md)。原测试者UNKNOWN_PARENT的原数据、原Space、原生中文IME及真实provider仍保留待验，不将合成场景替代原案。

机器可读回执见release-receipt.json，源码审核及插件资产明细见receipts/。
