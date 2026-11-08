# Agent 所有者可见性 v0.12.66 发布

状态：2026-11-09已完成GitHub正式Release及生产部署。冻结436a3101；Web/Client/API.66，LocalSync.13.5/protocol.6.1。

完整8562pass/0fail/9条件skip，types/lint/build通过；1470部署源、三服务五health、公网五入口资源一致，环境两文件哈希保持。配对备份及隔离恢复通过。生产8项所有者/权限/中英/390px验收通过，两轮自建资源均撤销/软删除并读回，未调用模型。

首轮浏览器业务及清理通过但opaque localStorage初始化导致整体失败，原失败回执保留；仅验收脚本修正并回归8/8，产品源未变。绑定/协作选择器为本地组件证据，生产未保存绑定或运行模型。独立复核无未解决重要问题。

证据：agentwiki/docs/verification/agent-owner-release-v01266-20261109/README.md；发布https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.66。
