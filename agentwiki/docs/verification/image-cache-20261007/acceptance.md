# 私有附件缓存验收

候选 `d78c4af9803068216486258f2c4fcc971c38c766`，发布版本 `v0.12.16`。

服务先鉴权、检查 Space 权限及文件可读性，再按 Express freshness 语义判断 ETag。响应 private / no-cache、Vary 两种凭据；304 关闭未使用的文件流；内容访问错误包括控制器前的认证错误都是 no-store。Sync v3 专用内容路由的 no-store 保持不变。直接审阅最终 diff，没有另派独立审查代理。

11 项 HTTP 测试使用真实 Nest 控制器、CombinedAuthGuard、AuthorizationService 与 AttachmentService，隔离的账户/数据库/流数据 fixture。修复前 9 项失败，修复后全通过；撤权、删除、另一账号、退出请求均不能返回 304。修改测试还验证在 /api 前缀下和原有 Vary: Origin 共存。完整后端 2983 通过、26 个可选数据库测试未运行；前端相关 37 通过；后端类型检查、修改文件 ESLint、完整工作区构建通过。构建存在既有 Mermaid 大包/分块提示。

实际生产使用已登录 Chrome 读取用户现有五图页面，不改页面或权限。首次四个 200、一个重复图片 304，传输共 1,109,424 字节；切换文档再打开后五个条件请求均收到实际网络 304，合计 1,716 字节，未传输图片正文。证据来自 Network.responseReceivedExtraInfo 的真实网络状态和 loadingFinished 字节数，非浏览器合成的 200。事件未截断且无未读分页；DOM 五图均解码、加载框为零；滚动附件请求为零。

未登录公网 GET 即使带 If-None-Match: * 仍然是 401 / no-store。没有在生产修改真实用户权限；权限撤销与账号切换覆盖来自上述真实鉴权链的隔离 HTTP fixture。

生产版本 0.12.16，三个用户服务 active，公网 health 五项 ok。服务器与候选附件控制器 SHA256 为 b3f214bb88fc5397b4008005138b6c4ea363d653b602ef70f2b2a06bf95de951；异常过滤器为 a807216e35c5371310cfd762a7f22bb4f82866e6820532e87d71d7e4ceeb1116。部署保留上一应用树 /root/agentwiki-previous-20261007183037。

公开记录只保留匿名网络结果；生产页面截图仅存本机 /tmp/agentwiki-v0.12.16-acceptance/production-cache.jpg。浏览器已恢复用户原先阅读的文档。

缓存可能被浏览器回收；首次获取或强制刷新仍可完整下载。每次正常复用仍须一次权限/版本校验，不能等同于无网络等待。
