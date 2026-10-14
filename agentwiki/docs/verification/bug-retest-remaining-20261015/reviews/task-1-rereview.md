# Task 1 scoped 复审

**结论：PASS。R1–R3 均 ADDRESSED；本轮补修未发现新增阻塞问题。**

- 范围：`320906ef` 的 `task-1-fix-review.diff`，以及 `8b6d6272` 的 `task-1-bundle-review.diff`。已读 brief、原 review、report 和 constraints；当前检查树为 `4e8fc153`，本组源码与该提交一致。仅审查原 finding 和补修引入的问题。
- R1 **ADDRESSED**：`loadEditableRun` 合并 summary/details，并明确保留 summary 的 startedById、templateId、spaceId；详情的较新 version/inputs 继续生效。真实双请求形状的 draft/ready、异账号/异模板及合法恢复回归覆盖原缺口。
- R2 **ADDRESSED**：开始新运行仅移除当前 scoped 指针，不删除未采用的 legacy；restoreLegacyPointer 阻止同一向导因语言重载再次采用 legacy，账号/路由切换则重置。原成功迁移仍核对读取时的 legacy 值后清理。
- R3 **ADDRESSED**：initialize 不再在重试开始时解除 restoreFailed；模板/成员失败保留锁定，成功恢复或确认没有指针才清除，显式新运行仍可退出恢复。
- 文案拆分 **PASS**：三个调用组件使用稳定 useCallback 包装局部译文并回退 sharedT，子组件继续收到同一 t；现有参数替换与中英文文案保留。bug-editor 两个使用点直接读取局部字典；九个 commonLabels 的原两语言值完全相同。未发现丢失调用点或绕过 bundle 门槛。

证据边界：沿用实现报告的 232/232、tsc/lint 收据，未重跑。已读取 root 的 `/tmp/agentwiki-remaining-20261015/client-build-final.log`，最终构建完成；旧 task-1 报告中的超出 117 bytes 是被后续共同标签去重解决前的收据。CodeGraph CLI 返回无可用索引，随后只读实际源码。未改产品代码、操作 UI/生产或创建子代理；原 billy 数据/浏览器与发布验收不由本复审替代。
