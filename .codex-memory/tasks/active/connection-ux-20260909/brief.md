# 接入体验根本改造

## 目标
用户确认：Obsidian 浏览器授权自动连接；Agent 可恢复分步接入，连接与知识导入分开，实际客户端读取验证。

## 状态
主集成分支 codex/connection-ux-20260909，当前运行代码3bc92e26；基线bbe5c1f5。应用候选0.11.0，LocalSync0.10.0，protocol0.6.0不变。插件独立分支准备0.5.0，基线7f628b5。

## 实现与复审
- Task1认证：已集成并独立复审C0/I0/M0。
- Task2分步CLI：已集成；两轮配置冲突/归档失败修复已独立实文件复审C0/I0/M0。全LocalSync907pass+1skip。
- Task3插件：浏览器连接实现完成；原生发现SecretStorage key不兼容已修；取消/卸载/换服务器并发修复中。新Vault实际browser→exchange/activate通过，映射未验。
- Task4网页：已集成，授权用途/登录回跳/过期续接/复制提示/IPv6修复通过最终server/web累计复审，原审查者另补五项增量。全client1447pass，中文/英文桌面及390px检查通过。
- 最终整分支/跨仓复审进行中，候选尚未公开发布/生产部署。

## 验收
专用预览5198/API53098；PG55448/Redis56398，独立两个DB、原56迁移，无schema变化。全server2602pass4skip，专用接入DB3另通过；全lint、typecheck、shared/protocol/server/client及LocalSync构建通过（第一轮新增测试旧版本literal失败已修正，保留证据）。干净安装、最终typecheck/lint通过；runtime263通过/1平台跳过，DB206通过+1环境失败，独立空库重跑失败文件4/4通过。

真实Codex消费网页复制提示词，完成授权、选择Space/权限、确认、安装与网关验证；wiki_get_page被隔离宿主审批策略阻止，等待用户确认仅放行测试读取。Obsidian原生窗口被另一任务使用，等待映射/恢复验收。只有本轮测试home/Vault可修改。

## 恢复入口
读refs与中央SDD progress及task报告；不要重复派已完成任务。旧reading工作树/环境、HANDOFF.md、原Vault与知识内容均保留。
