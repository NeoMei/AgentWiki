# 目标

逐项修复并回写《10-22Agentwiki测试问题》12项；原页f31ccf05-70d0-4376-95c3-f507a5bb1bce，项目管理Space cmtmgsk5b00neuo709n0x7nqj。

# 当前状态

- 12项修复已随Web/API v0.12.57发布，源码commit192315ed；Local Sync0.13.5精确版本和GitHub Release也已发布。npm latest标签仍需用户完成新的安全密钥验证，见release-v01257-20261023。
- 图谱ID解析/旧快照升级、同向同类型去重、空描述、目录提示/高亮、搜索路径/范围、中文运行过滤、终态任务、通知同页/跨页同步均已修复并独立复审。
- 最终单次full suite8223 pass/5环境skip；server3591、client2814、protocol140、local-sync1125、runtime314+239；build/typecheck/lint及17项本地Chrome通过。本地浏览器使用合成API，不能冒充生产业务验收。
- 生产1422源码、HTML/5资源、三服务/五项health通过。发布记录见agentwiki/docs/verification/bug-report-20261022/release/README.md。
- 原报告12条开发回复、12条回归及12条发布跟进均已保存并精确MCP回读，Chrome36条标签和18图元素核实，原文保留；最新ChangeSet cmvjujvlh006kaba3m4yav8wz。

# 后续

原billy环境逐项业务人工回归，尤其持久化、关系再提取、通知跨标签等，尚未计为完成；原报告每项保留具体待验场景。原本地阶段详细证据保留于docs/verification/bug-report-20261022/README.md，当前发布状态以release记录为准。
