Agent 接入 AgentWiki MCP 时改为使用本地安装的网关运行时，不再在每次宿主启动时联网执行 npx。无外网或 npm registry 不可达的机器也能稳定启动 MCP，避免连接超时。

- 接入阶段将 `@neomei/agentwiki-local-sync@0.13.6` 一次安装到 `~/.agentwiki/runtime/local-sync-0.13.6`。
- 宿主 MCP 配置写入绝对 Node 可执行文件与本地 CLI `dist/installer/gateway-runtime.js` 路径，启动零网络依赖。
- 服务端生成的上手指引同步说明本地运行时启动方式，兼容既有 0.13.5 客户端。
- Local Sync 冷安装验证：空 install/cache 从 registry 装到 0.13.6，`gateway --help` 可用。

Web/API/Client 0.12.67；Local Sync 0.13.6；sync-protocol 0.6.1。
