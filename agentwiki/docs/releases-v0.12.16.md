# AgentWiki v0.12.16 发布记录

## 图片缓存

附件内容接口允许浏览器私有缓存，但每次复用必须重新向服务器校验。服务器先完成现有身份认证和 Space 访问检查，再比较 ETag；图片未变时返回无正文的 304，变化时返回新图片。使用 `Vary: Authorization, X-API-Key` 隔离两种凭据，不给共享代理缓存。

鉴权失效、Space 权限撤销、切换到无权限账号或附件不存在时，返回原有错误并禁止缓存。强制刷新仍可以重新下载图片。前端继续通过共享登录客户端获取 Blob，没有新增应用层缓存或持久化凭据。返回 304 会关闭已打开但无需传输的文件流。

应用版本 `0.12.16`，Local Sync `0.11.0`、同步协议 `0.6.1` 不变。本版不需要数据库迁移或 Obsidian 插件更新；Sync v3 专用内容接口仍保持原有 no-store 契约。

## 验证

- 新增真实 Nest HTTP 路由、CombinedAuthGuard、AuthorizationService、AttachmentService 测试；数据库、账户查找与存储使用独立 fixture。
- 11 项 HTTP 回归涵盖首次下载、强弱 ETag、多候选、通配符、内容变化、强制刷新、撤权、账号切换、退出登录和附件删除。修复前 9 项失败，修复后全部通过。
- 完整后端回归 166 文件 / 2983 项通过；5 个可选数据库套件 / 26 项未运行。
- 前端 Markdown / AttachmentImage / attachmentApi 相关 37 项通过；后端 TypeScript 和修改文件 ESLint 通过。
- 生产浏览器缓存与服务状态在部署后记录。
