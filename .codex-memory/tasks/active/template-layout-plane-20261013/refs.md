# 证据与入口

- 工作树：`/Users/neomei/.codex/worktrees/template-layout-plane/AgentWiki `（末尾空格）。
- 所有 Git 命令显式传入该路径的 `--work-tree`；共享 core.worktree 指向原检出，不得修改。
- 本地模板预览：http://127.0.0.1:5187/spaces/preview/new?from=collaboration
- 本地协作预览：http://127.0.0.1:5187/spaces/preview/collaboration/runs/design-run
- 本地文档预览：http://127.0.0.1:5187/pages/overview
- 本地任务看板：http://127.0.0.1:5187/spaces/preview/taskboard
- 临时运行器：`/tmp/agentwiki-template-design/`，端口 5187；真实源码组件、Axios 合成数据、Socket stub；不访问生产 API。
- 固定截图与日志：`/Users/neomei/.codex/visualizations/2026/10/12/01a130d1-6332-7282-96eb-8a5399507e3f/agentwiki-template-redesign/`。
- 截图：catalog-desktop/mobile、structure-desktop/mobile、document-desktop、collaboration-desktop、run-desktop/mobile/long-content、taskboard-desktop/mobile。
- 最终测试日志：tests-final.log（709 pass）；构建日志：build-final.log。
- 测试范围：page-templates、collaboration、taskboard、PagePreview、Markdown、MarkdownWorkspace。
- 预览所需 node_modules 是原检出依赖的符号链接，不纳入提交。
