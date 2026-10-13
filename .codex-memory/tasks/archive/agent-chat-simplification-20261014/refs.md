# 来源与回执

- 用户参考图：/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/codex-clipboard-66aea094-d5d6-42c7-bda3-6f75c4495649.png
- 生产组件：agentwiki/apps/client/src/features/agent-session/{AgentSessionPanel,AgentReferencePicker}.tsx
- 业务边界：useAgentSession.ts、AgentSessionRegistry.tsx、AgentSessionNotes.spec.tsx。
- 工作树：/Users/neomei/.codex/worktrees/agent-identity-space-auth/AgentWiki （目录尾空格）。Git 必须显式 --work-tree。
- CodeGraph 已尝试；返回该工作树未索引，使用直接代码工具。

- 完整视觉/交互收据：agentwiki/design-qa.md。
- 最终证据：/tmp/agentwiki-chat-qa-20261014/{client-final.log,client-build-final.log,client-lint.log,desktop-final.png,editor-reference-final.png,mobile-stress-final.png,editor-accepted-draft.png}。
- 浏览器：Codex In-app Browser；1600×1000、1280×720、390×844，DPR1。所有模型/API数据均为本地合成fixture。
- 本地预览 http://127.0.0.1:5184/e2e/fixtures/agent-chat-fixture.html?mode=edit；API 5183。当前运行用于本轮交付，后续须先检查进程是否仍在。
- 启动API：node apps/client/e2e/fixtures/agent-chat-api.mjs；启动Vite：AGENTWIKI_DEV_API_ORIGIN=http://127.0.0.1:5183 pnpm --filter @agentwiki/client exec vite --host 127.0.0.1 --port 5184 --strictPort。
