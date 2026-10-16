# 10 月 16 日复测反馈修复

用户要求继续修复原报告剩余 #1/#2/#12/#13/#17/#19，并明确使用当前远程Windows Session寻找黄金书屋、验收最新Obsidian插件。其它14项按用户已复测通过保留。

## 已完成

- Web基线v0.12.44/35f73159，产品07d6abc9修复五项反馈；新增65e91103/02157186修复真实Windows暴露的服务端v2历史链误拒。
- 0.12.45生产回验发现真实历史个人单页仍英文，cfc1db6a补齐严格冻结legacy版本来源；0.12.46/42142cdc已发布部署，精确同一原运行及原截图对照三处中文，运行本身未修改。
- #12/#13/#17/#19有对应生产原生回验；关系删除真实写入只在隔离环境覆盖。
- 全仓7653通过/6既有skip，typecheck/lint/build及独立审查通过。联合备份、1351源码与两个编译模块hash、三服务/health/63迁移/32smoke通过，fixture已清理。
- 插件正式0.5.11/7e81b9f已发布，产品becc0a1复审PASS；完整1526测试，Windows57机制测试、临时原生启用/重载、正式CI三资产及attestation通过。
- Windows真实黄金书屋已找到，0.5.10只读预览24本地/0远端，另一个映射的服务端410已消失；未同步写入。

## 最终原环境回验

真实Vault已备份升级正式0.5.11，重启确认loaded/enabled/version和目录，两个Space只读差异通过。黄金书屋本地24/远端0；实际viewer/canPublish=false、头部只读，禁用上传策略符合权限。113正文文件、配置、映射、基线不变；仅tree-identities封装代次更新、payloadhash保持。没有执行同步或改授权，任务已归档。最终回执official-plugin-windows-0511.md。

## 验收边界

黄金映射首次pending→active归因未知；24是本地差异，非已同步或冲突计数。真实DataAdapter重绑竞态fixture未运行。ordinary cutover retention仍保守拒绝。两份inactive TEMP诊断删除被自动审批规则拒绝，未绕过。

当前详细结论：agentwiki/docs/verification/retest-feedback-20261016/status.md；早期阶段状态冻结在stage-history.md。
