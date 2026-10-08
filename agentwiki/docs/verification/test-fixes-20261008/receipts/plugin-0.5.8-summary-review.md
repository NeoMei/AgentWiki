# 0.5.8 预览修复与最终门禁

正式源码：`b9be0afa667e216c87a15f983431109f79b5ca39`，前一版 `324fa53b3990fe276ebb1f12b4627a51e8a6b049`。

- `5449b2bf`：V3 pull 预览摘要由静态数组改为当前 preview 的函数供应；真实 main→Modal 回归先复现手动父目录路径改变而摘要不刷新，再通过修复。版本元数据更新为0.5.8。
- `b9be0afa`：V2 Modal 按实际 runtime 的页面后目录顺序生成只用于展示的派生预览；原 preview/guard 保留给最终确认重校验。非法预设或新选择在确认前禁用，异步 generation 防止过时成功/失败回写；手动路径与后代摘要同步改变。新文件 `tests/integration/v2-preview-materialization.test.ts` 含4条 main + SyncRuntime + Modal 集成回归。
- 修复阶段独审 `review_preview_summary` 通过V3及发布元数据；`review_v2_materialization` 通过最后V2/V3差异，无P1/P2/P3，独立验证30条 main/新回归及22条 modal/pull 事务用例。上述为同一连续工作中的已有审查结果，不冒称文档整理时重新运行。
- root 已读取最后差异与原始门禁输出；最终 `npm run check` exit 0：70文件、1422测试通过，格式、类型、构建、bundle/发布元数据通过；lint0error/19既有warning。
- 原始门禁session26600，chunks7bdc82/d668a8，UTC2026-10-08 19:05:40→19:06:09；`plugin-0.5.8-final-check.log` SHA256 `4fb34e5c3b927b59aa631ae1a8d9310792a8d7af29497a35c11b1981b2919e10`，保留对应raw JSON。不是另行伪造一次测试运行。
- Windows依赖安装曾被EALLOWREMOTE拒绝；未放宽策略。原生验收改用发布工作流构建、逐文件签名验证的正式包，不使用依赖复用产生的不同hash包。
- [正式资产/工作流独立复核](plugin-0.5.8-release-verification.json) 与 [原生同步回执](windows-live-sync-20261009.md) 分别记录；1422测试和签名不能替代原生冲突实际操作。
