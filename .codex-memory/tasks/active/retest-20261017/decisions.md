# 决策

- #3/#4/#5与#6自然日已在基线修复，保留实现并复测；只修全状态排序与重复导航。
- 审核按createdAt DESC/id DESC，在SQL分页前排序；新旧接口一致。来源内嵌RunsPage隐藏返回，独立渲染保留。
- MCP命名字段与完整legacy __args兼容，重复字段冲突拒绝，授权/CAS不削弱；原wrapper报错未复现。
- 插件只加诊断及白名单导出，不清理事务或正文；错误上下文须按实际失败阶段归因。
- isolated fixture/SDK/HTTP证据不冒充生产published或Windows原恢复；不把未部署候选写成线上关闭。
- 未获本轮发布阶段执行结果；无push/发布/部署/日常Vault升级。
