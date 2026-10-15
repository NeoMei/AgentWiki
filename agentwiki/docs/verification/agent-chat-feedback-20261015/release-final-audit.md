# v0.12.37 发布回执最终一致性审计

审计方式：只读本地发布提交、日志、JSON回执和两张生产截图；没有重跑测试、扩大代码审查、访问生产或操作SSH连接。

## 结论

**PASS：未发现发布或验收回执之间的阻塞性矛盾。** 现有证据支持“0.12.37已部署、公开服务和本次功能生产验收通过”。父级已同步更正准备中状态，正在提交最终证据文档。

## 身份与门禁

- 本地HEAD和origin/master均为 `9b7a3b90efd538bcea067fbab0344fec856d9b6f`；`v0.12.37`是annotated tag，tag对象24e4c917，其peeled commit正确指向9b7a3b90。相对已审查集成f615ec77，产品目录仅三个package version变更，未追加业务源码。
- `git diff --check 10473919..9b7a3b90`通过。
- 原始测试日志分别记载 runtime309/1skip、database239/0skip、server3243/4skip、client2589、protocol140、local-sync998/1skip，合计 **7518 passed / 6 skipped / 0 failed**，与release-gates.json一致。没有把测试里刻意触发的400/401/403/429/500负例日志当成套件失败。
- 完整build日志成功，入口JS **549905/550000 bytes**；typecheck/lint无错误诊断。退出0来自已记录release-gates回执；剩余95 bytes是已知非阻塞预算余量。
- GitHub Release发布和push成功由父级实际执行回执声明，本轮未重新查询GitHub；本地tracking ref/tag一致性已核实。不要将本轮说成独立远端重查。

## 备份与部署

- backup-receipt记录先于部署：数据库custom dump经pg_restore列表校验684项、文件校验和通过；配套应用/配置/附件归档可列出、142个永久附件blob前后manifest一致。API和Worker在数据库与附件快照期间inactive/MainPID=0，之后恢复active。快照范围和恢复配套要求明确。
- 备份记录如实标注旧应用版本0.12.36，但旧源码SHA来自此前回执，非本次独立验证。上述是备份归档完整性检查，**不是实际恢复演练**。
- deploy.log达到“Direct deployment complete”，production.json记录版本0.12.37、**1328个源码文件/0 mismatch**、3个服务active、health五字段ok；public.json健康状态一致、页面HTTP200，5个入口资源与生产产物匹配。
- stable-comparison为true，凭据83、Grant495、Agent813、Space policy1476的稳定字段未变；smoke.log为32 checks passed。

## 生产功能验收

- provider-acceptance以公开生产API执行真实question/proposal，两轮均done且终态progress移除；question采到preparing/waiting/generating，proposal采到waiting/generating，均仅phase/attempt字段。两轮执行后保存正文不变。**本次证明真实阶段反馈，不是逐字流，也没有证明每次轮询都能观察到finalizing。**
- production-active.png实见“正在生成回答”“已用时7秒”和停止入口；production-compact.png实见单项修改、唯一“接受到草稿/丢弃”和折叠的“查看修改”。本次两张生产图为桌面；390px验收来自前面的本地合成API，不能改称生产手机验收。
- browser-page-before与after-accept同一page/space、updatedAt和contentHash完全相同，hasAddedHeading=false；after-save同一page/space的时间和hash变化，hasAddedHeading=true。该回读与“接受只改草稿，显式保存才落库”一致。
- 初次辅助probe的超过32字符Space名称导致400，属于探针输入问题；父级说明已改短名，最终真实provider回执通过。cleanup含该早期临时user的soft deletion，不应报告为遗留产品失败。
- cleanup.json两临时Space、临时Page及两临时user均有deletedAt，本次验收相关activeTasks为0；provider清理额外记录Space404、Session403、login401/JWT401。此处“清理完成”指**soft deletion与权限撤回**，审计记录保留，不能声称物理删除全部数据。

## 归档收尾

本轮首次读取时，9b7a3b90内的 `status.md` 与 `release-gates.json.production` 仍为准备中。父级随后确认已同步更新status/release-gates/current/brief/index/refs为发布验证通过，并生成deployment.json；这些修改与审计时间交错，当前等待统一文档提交，发布tag保持不变。按父级要求不重复扩大检查。先前记录收尾项已有对应处理，不是产品部署阻塞。

未关闭或更改用户SSH会话。
