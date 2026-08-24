# 协作映射内准备 Agent

## 目标

修复协作运行“映射 Agent”在没有已授权可执行 Agent 时无法继续的问题，使 Owner/Admin 能在同一向导内选择或创建 Agent、恢复状态、授予当前 Space 执行角色、生成 MCP 接入指令、确认接入并完成当前 Role Slot 映射。

## 当前阶段

- Tasks 1–5 实现已完成，Task 6 全门禁、桌面/390px 真实 Browser、隔离 Local Sync onboard 与权限验收已通过。
- Browser/runtime product 验收基线为 `e83d1530aa4d93c5a22104360e0dbef193750a2a`；纯测试合同补充后的 final automated gate 基线为 `658538ced957f683b7e6131d688c5c0a41bb7590`，全仓 2,304 个测试通过，53 个既有环境依赖测试跳过。本轮未重跑 Browser。
- 验收中发现 worker 误订阅 Socket.IO relay 的真实缺陷，已按 TDD 修复于 `e83d153`；`658538c` 又显式锁定 unset role 默认 API 和 worker 仍可 publish assist 的合同，mutation proof 与回归测试 22/22 通过。
- 隔离 schema、fixtures、Redis 临时键、进程与临时配置/截图已全部清理。
- 本地实现已验证；push 和生产发布未授权。任务继续保持 active。

## 完成标准

- 设计、计划、TDD 实现、回归和真实全链路验收完成。
- 权限不足、部分成功、接入过期和并发陈旧响应有明确行为。
- 未经单独授权不推送、不发布 npm、不部署生产。

## 本地验收结论

- 上述三项本地完成标准已满足。
- 外部发布尚未授权，因此不归档本任务。
