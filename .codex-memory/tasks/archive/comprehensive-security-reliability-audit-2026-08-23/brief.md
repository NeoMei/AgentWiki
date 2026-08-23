# 综合安全与可靠性审查（2026-08-23）

## 目标

对当前 AgentWiki 工作树进行多轮全仓代码审查，修复所有值得修复的安全、授权、并发、资源与产品流程问题，并以全量测试和构建结果收口。

## 完成结果

- Source/Run/Memory 写入在事务临界点重验实时 Agent Grant 与 Credential；去重和 P2002 分支不再绕过授权。
- Run retry 改绑当前调用者身份，不能继承旧 Publisher 的自动发布能力。
- WebSocket 增加当前账号、authVersion、JWT 到期、页面读写权限、被动连接撤权、用户级连接/房间/事件限制、单飞授权扫描和资源清理。
- OpenCode 编辑助手使用隔离 HOME/XDG、deny-all tools，并拒绝 tool event；Assist HTTP 仅允许 human principal。
- Memory 配额与 consolidation 使用 Agent advisory lock；过期记忆不可合并，归档去重 winner 原子恢复为 active，昂贵 embedding 前先做授权/去重/配额预检。
- HTTP 限流同时覆盖 IP、Bearer Agent Credential 与 X-API-Key，fallback 有硬上限且 Redis 失效时不再被旋转 key 撑爆。
- Git 导入增加树、字节、对象存储、遍历和深度上限，partial clone、LFS smudge 与全局/system Git filter 隔离，生产 Worker `/tmp` 由 systemd/Docker tmpfs 硬限制为 256MiB；Local Sync 严格校验 `spaceId`。
- Obsidian 安装、服务器 `/api` 地址、连接码和设备管理统一到 `/guide/obsidian`；旧集成页删除并重定向。

## 状态

修改与验证完成；应用与 Local Sync `0.5.1` 发行候选已通过完整测试、静态门禁和空目录安装验证，正在执行 GitHub、npm 与生产发行。
