# 10-08修复正式发布与部署

状态：网页 **0.12.17已发布并部署**；独立插件 **0.5.7已正式发布**，未安装日常Vault。用户在本地候选验收后明确要求“那就发布啊”，因此本阶段已有直接发布授权。

## 发布身份

- 网页：[v0.12.17](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.17)，发布源码/tag解引用 `4d88ee2bb3af706050f5d88e038b7faf57ea0f2e`；远端master快进至同一提交，无强推。之后补充的交付记录不改变发布tag和运行源码。
- 插件：[0.5.7](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.7)，main/数字tag均为 `324fa53b3990fe276ebb1f12b4627a51e8a6b049`，正式CI、下载资产与attestation通过。
- Local Sync 0.11.0、协议0.6.1保持，不发npm；没有新增迁移。

## 精确发布提交验证

网页4d88ee2b重新执行完整test/typecheck/lint/build：6952通过、0失败、6跳过；runtime数据库230项零跳过。六条跳过仍为2条Windows原生、1条独立CodeGraph验收、3条专用连接授权门禁。类型检查和构建通过；lint0error/3既有warning，首屏542577/550000字节。发布元数据独审C/I/M=0/0/0。插件0.5.7在本地及GitHub均1418项通过；正式三资产下载字节与冻结产物相同，并验证精确SHA/tag/workflow证明。

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

原案UNKNOWN_PARENT、原Space数据、原生中文IME、真实provider，以及Windows/V3原生边界仍待验，详见status.md；发布成功不等于这些原案已经复验关闭。

机器可读回执见release-receipt.json，源码审核及插件资产明细见receipts/。
