# v0.12.46

修复旧版个人及 Space 单页模板创建的协作运行仍显示英文的问题。部分历史模板版本没有新版 definition、schemaVersion、definitionHash，模板目录会合法地将其转换成默认单页流程。运行详情现在识别这种完整的历史格式，沿用默认流程的界面语言；自定义流程和不完整历史元数据不会被误判。模板正文、任务、角色与运行状态保持原样。

本次只修改服务端运行来源识别与对应回归测试。Web/API 0.12.46；Local Sync 0.13.0、protocol 0.6.1 不变，无依赖、数据库结构或 npm 包变更。

固定产品候选 cfc1db6a 独立审查PASS（独立144测试通过），最终整仓7653通过/6项既有跳过/0失败，typecheck、lint、build均通过。生产发布与原运行复验分别记录在 [验证回执](verification/retest-feedback-20261016/v0.12.46/release-preparation.md)。
