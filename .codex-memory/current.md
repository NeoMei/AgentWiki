# 当前目标

- 参考用户提供的 Plane 工作区，完成 AgentWiki 内置模板和相关页面的简明版式改版。

# 范围 / 不做

- 范围：新建模板目录及预览、项目/软件开发文档样式、协作模板与运行面板、任务看板。
- 本轮未发布部署；已有页面正文、模板版本及后端数据未修改。

# 当前状态

- 本地 `codex/template-layout-plane` 改版已实现并完成独立复审。
- 39 文件 / 709 项相关测试、TypeScript、变更文件 ESLint、构建及 diff 检查通过。
- Chrome 桌面/354px 窄屏、1024×768 长内容和英文布局验收通过；使用真实前端组件加隔离合成数据，不代表生产 API 或线上验收。
- 两个复审 P2（长文挤压运行任务区、里程碑定位参照）均已修复并复审关闭。

# 稳定约束

- 仓库路径末尾空格；worktree Git 必须显式 --work-tree，不改共享 core.worktree。
- 保留原检出及未提交资料。模板历史版本和用户正文不自动覆盖。
- 本地实现、独立审查、浏览器合成验收和线上发布分别记录。

# 关键索引

- 工作树：`/Users/neomei/.codex/worktrees/template-layout-plane/AgentWiki `。
- `.codex-memory/tasks/active/template-layout-plane-20261013/brief.md`、`decisions.md`、`refs.md`。
- 本地预览：http://127.0.0.1:5187/spaces/preview/new?from=collaboration
- 其他既有任务状态见 `.codex-memory/tasks/index.md`，本轮未继续处理。

# 风险 / 下一步

- 改版尚未线上生效；后续发布需独立执行部署与生产回读。
- 本地预览后端为合成数据、Socket 已隔离；不用于证明真实创建或 Agent 运行。
