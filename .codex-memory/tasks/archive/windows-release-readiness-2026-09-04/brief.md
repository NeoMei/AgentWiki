# Windows release readiness audit

## 目标

- 根据 `测试报告/AgentWikiQ/问题清单-缺陷详情.md` 复核既有修复，并重复执行任务、代码、测试和 UI 审查，修复所有可复现且值得修复的问题。

## 完成结果

- 修复 Windows 下 pnpm/npm/npx、OpenCode 与开发服务启动对 shell/shim 的依赖。
- 修复 Windows 路径、ACL/权限诊断、目录 fsync、锁清理、CRLF 与 CodeGraph 文件语义。
- 修复 Page、Knowledge relation、Graph refresh/settings 在锁外授权导致的撤权 TOCTOU，并确保审计 actor 使用当前身份。
- 修复客户端路由请求竞态、认证强制改密守卫、管理/来源/运行页错误处理、交互状态、触摸/焦点、图谱键盘访问及多处双语文案。
- 移除存在高危漏洞且无修复版本的 `image-size`，改用有界的允许列表图像尺寸解析；固定已修复的 `fast-uri`、`qs` 和 `browserslist`，最终 `pnpm audit` 无已知漏洞。
- 最终全仓测试 4044 passed、79 skipped、0 failed；typecheck、lint、build 通过。
- Browser 完成公开页面桌面与 390x844 移动交互检查，控制台无 warning/error、页面无横向溢出。

## 未执行项

- Playwright 7 files / 25 tests 已成功收集，但其真实认证 fixture 需要 PostgreSQL/Redis；当前主机没有 Docker、psql、PostgreSQL、Redis 或相关测试数据库变量，因此未执行。
- 79 个 skip 对应数据库、Redis、CodeGraph 或其他明确外部前提；没有将其误记为通过。

## 边界

- 未修改用户已有 `测试报告/` 内容，未 commit/push/publish/deploy。
