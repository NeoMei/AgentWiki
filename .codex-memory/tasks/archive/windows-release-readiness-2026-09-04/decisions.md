# 决策

- Windows 下通过解析 pnpm/npm/npx 的 JavaScript 入口并使用 `process.execPath` 启动，避免 `.cmd`、PATHEXT 与 `shell:true` 的差异和注入面。
- 不在 Windows 上伪造 POSIX ACL 或目录 fsync 成功；仅跳过平台不支持的目录 durability 操作，文件写入/同步仍保留。
- 所有可改变 Page、Knowledge relation 和 Graph 状态的人工请求，在获取对应锁后重新读取实时授权，再执行写入。
- 对客户端异步页使用请求身份/路由身份保护，防止迟到响应覆盖新页面状态。
- 外部服务缺失时只运行可安全验证的单元、构建、收集和公开 UI 浏览器门禁，并清楚记录未执行项。
- `image-size@2.0.2` 的已披露无限循环漏洞没有可安装的修复版本，且项目只需四种允许格式的尺寸，因此移除该依赖并采用有界 PNG/JPEG/WebP/GIF 解析；其余传递依赖固定到已修复版本。
