# 插件 0.5.7 发布候选独立审查

- 仓库：AgentWiki-Obsidian 隔离 `test-fixes-20261008` 工作树。
- 精确范围：`d1d89de8270c2a629886d4b1688375d2d3dc8825..324fa53b3990fe276ebb1f12b4627a51e8a6b049`。
- 只读检查完整七文件 diff、既有 release workflow/check-release 契约及 fresh check 日志；未修改插件/Git、重复测试或派代理。

## 核对

1. package、manifest、lockfile 顶层及根包均一致为0.5.7；versions.json新增0.5.7→1.11.5，旧版本映射保留，最低Obsidian版本和运行依赖未变。metadata测试改为验证当前版本映射，比原只检查0.5.3更贴合本次发布，不削弱当前版本一致性。
2. `.github/workflows/release.yml` 仍由数字标签触发，Verify tag version要求标签精确等于manifest版本。因此正确标签是 **`0.5.7`，无v前缀**。workflow继续先执行npm run check，再为main.js/manifest.json/styles.css生成attestation，并以`--verify-tag`发布这三份资产；`docs/releases/0.5.7.md`与其notes路径一致。本delta没有改工作流或跳过门禁。
3. CHANGELOG与release notes只声明已审的父目录删除/远端后代冲突、保留时建目录、显式路径移动及双语提示，没有声称解决所有UNKNOWN_PARENT。说明准确区分e5b8a3a的macOS Sync V2原生证据与后续字符串/元数据修改，并明确原测试者现场、Windows、Sync V3原生待验。未把本地验收写成部署、日常Vault安装或原案全面关闭。
4. 读取 `/tmp/agentwiki-sync-0.5.7-check.log`：69 files/1418 tests通过，production build、bundle safety（1747313 bytes）、release metadata 0.5.7通过。没有重复执行测试。执行者另报告prod依赖audit为0；本审查不把这扩大为全部开发依赖无风险，既有工程告警triage不变。

## Verdict

**C/I/M = 0/0/0。Approved，0.5.7发布候选可继续正式发布。** 这七文件仅为版本元数据、测试与说明，之前产品源码批准仍有效。用户正式发布授权已由root明确传达，本审查不增设确认要求；实际tag推送、CI、release资产与安装可用性仍以发布执行者随后回执为准，当前不宣称已经发布。
