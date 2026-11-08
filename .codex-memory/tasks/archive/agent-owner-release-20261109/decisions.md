# 决策

- 发布分支保持codex/agent-autochat-external-opencode，基于origin 850ec950与已有本地f100ea9a。
- Web/Client/API计划0.12.66；LocalSync0.13.5/protocol0.6.1不变。
- canonical已有design/不入发布；从配置根/Volumes/codex/new-worktrees创建冻结detached树。
- Quukk基线复审发现Compose空gateway回归，发布前修正并回归。

- 最终冻结436a3101；验收工具/回执后续提交仅文档，不改变部署源。
- 生产Page创建会触发索引embedding，因此验收仅空Space/Agent/Grant；绑定与协作保留本地测试证据。
- 首轮浏览器init错误已保留并单独修正，不伪造首次通过。
