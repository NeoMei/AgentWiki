# 目标

响应用户指出原报告第12项人工复测未修复，修复已读历史仍被统计为未读的问题并回写原因/验证。

# 状态

根因已确定并独立复核：NotificationService.list的count错误传visibleWhere(false)，缺少readAt:null。旧版本真实DB4组业务断言全部失败，新单行修复5pass/0skip；server3591pass/3环境skip、client通知9pass、typecheck/lint/build通过。源码冻结19da88eb，Web/API/client0.12.58；Local Sync0.13.5/protocol0.6.1不变。clean detached tar1423文件零偏差，新生产.57配对备份验证并独立复核，部署已成功；生产1423源码/5公网资产/三服务五health、65迁移无pending均通过。原billy实际服务只读诊断unread1→0且通知ID/readAt哈希未变；原报告补充published并MCP/Chrome回读，billy浏览器人工复验仍待执行。

# 边界

不改线上通知数据、不迁移readAt。billy生产只读实际服务诊断为已读历史1/真实未读0但旧API字段1；当前浏览器登录MeiXueFeng，未冒充billy浏览器人工复验。原报告已读时间与实时行时间可能来自不同历史复测，保留原文，不将具体时间差当作另一根因。
