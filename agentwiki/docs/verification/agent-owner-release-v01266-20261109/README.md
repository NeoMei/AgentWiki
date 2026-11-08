# v0.12.66 Agent 所有者可见性发布

2026-11-09（北京时间）已正式发布 GitHub Release 并部署生产。冻结源 `436a3101fe7bd4de240ae8edc82be5ac7261d8e3`；版本 Web/Client/API 0.12.66，Local Sync 0.13.5、protocol 0.6.1 保持。

- 所有者展示：列表、详情、空间成员、页面/目录绑定、协作角色、任务改派。使用真实 owner 的姓名及账号区分同名 Agent，原授权保持。
- 发布包括已有 Quukk 回退支持；修正空/空白文本网关配置的兼容性，生产两个环境文件哈希完全保持。
- 干净冻结工作树完整回归8562通过、0失败、9条件跳过；typecheck/lint/全包build通过。初始JS550838/551000字节。
- 9条件跳过：真实CodeGraph opt-in1、专用connection DB3、专用taskboard DB4、Windows ACL1；不扩展为Windows原生验收。
- 配对应用/配置/数据库/附件备份完成，随机隔离库恢复成功且临时库清理，未写业务数据库/附件。
- 1470部署源码全部匹配，三服务active，五health均ok；公网HTML与五入口资源匹配主机产物。
- 真实生产独立Chrome、两个临时同名所有者与同名Agent的8项API/UI/权限/中英/390px检查全部通过。7项授权/Agent/Space/User清理均API读回；JSON/截图已脱敏。
- 首轮生产浏览器业务检查及清理均通过，整体因初始化脚本在about:blank访问localStorage失败；完整失败JSON保留。新增回归先红，修正验收脚本后8项策略测试与最终生产浏览器全绿，没有为此修改或重新部署产品源。
- 页面绑定/协作选择器为本地组件回归证据；生产没有创建Page（避免隐式embedding）、颁发凭据、保存绑定或启动模型任务。真实模型质量不属于本次验收。

发布地址：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.66

备份与旧应用位置见deployment.json。回滚须考虑备份后新增写入，不可直接恢复旧数据库覆盖新业务。原未跟踪design/保持。
