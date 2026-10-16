# 0.12.46 发布准备

状态：固定候选独立审查PASS，最终整仓7653通过/6既有跳过/0失败，typecheck、lint、build均exit0；配套备份、正式GitHub Release和生产部署均已完成；1351源码hash、两个修复模块的编译hash、公网5入口资源、三服务、内外health、63迁移与32项业务smoke通过。原运行浏览器回验单独进行，不由发布成功推定。

## 问题与候选

0.12.45 发布后的真实个人模板运行仍显示英文。固定候选 cfc1db6a58c7ab77c65d1b86648d2af564748209 补齐旧模板冻结版本的合法转换路径：definition、schemaVersion、definitionHash 明确为 null，且 contentI18n 符合既有模板schema时，识别为系统生成的普通单页流程；缺元数据、部分新版元数据、无效内容继续拒绝识别。已有自定义流程边界保留。

真实生产运行的只读候选诊断显示 systemTemplateSource 从 null 变为 single-page，其余 DTO 字段不变；没有更改生产文件、数据库、模板正文或运行。该诊断不能替代上线后原浏览器验收。新增4项正例（个人/Space × 运行中/完成）与5项负例，定向144测试通过。

## 发布范围与门禁

- 版本仅更新root/client/server三份package.json为0.12.46；Local Sync0.13.0/protocol0.6.1不变。
- 产品差异仅run.service.ts与run.service.spec.ts；无依赖、锁文件、部署脚本、数据库结构或迁移变化。
- 最终 test:full、typecheck、lint、build 按顺序执行且均exit0；正式结果见validation.json。独立审查PASS与144测试结果见independent-review.md。

## 生产基线与备份

- 发布前重新验证生产0.12.45的1351个源码文件长度/SHA全部匹配a80746e6，三个服务active，内外health五项ok，公网入口hash匹配；见production-baseline.json。
- 配套备份脚本只改变预期旧版本、备份label和旧发布提交三个元数据字符串，操作逻辑完全不变，差异见backup-metadata.diff。语法检查通过。
- 备份将同时保存应用、配置、PostgreSQL custom dump和完整附件，API/Worker在DB与附件采集阶段停止，校验通过后恢复；已执行并通过DB toc/附件manifest/SHA校验，写服务已恢复，见backup-receipt.json；没有执行恢复演练。
- 0.12.45的全部发布回执保留在上层目录，不覆盖。本次部署和32项业务smoke将另写deployment.json；原生浏览器与Windows验收由主任务单独记录。

## 正式发布回执

[v0.12.46](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.46) 对应42142cdc，固定产品为cfc1db6a。全部生产检查见deployment.json；源码1351文件全部匹配，run.service编译模块与最终本地build相同，旧sync读链修复也保留。无新迁移，三个服务active，公网32smoke通过且专用对象完成API清理。前端代码未改变，因此主入口仍为index-BwaLUeIQ.js；不能把入口文件名不变误判为旧服务端仍在运行。

旧应用目录保留在/root/agentwiki-previous-20261016145004，回滚必须与本次备份的数据库、配置、附件成组恢复，不单独恢复应用。没有执行恢复演练。
