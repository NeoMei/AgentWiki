# 索引

## 持久证据

- `agentwiki/apps/client/src/features/agent-session/useAgentSession.spec.tsx`：旧读成功/失败、导航、取消成功/失权、回执隔离、目录来源失效。
- `agentwiki/apps/client/src/features/agent-session/{AgentSessionPanel,AgentReferencePicker}.spec.tsx`：会话错误隔离、Portal焦点。
- `agentwiki/apps/server/src/assist/opencode.runner.spec.ts`：多字节逐字节流、最终步骤空/工具/截断/无效响应。
- `agentwiki/apps/server/src/assist/{assist-session.controller,assist.controller}.spec.ts`：实际生产ValidationPipe拒绝错误类型。
- `agentwiki/apps/server/src/assist/{assist.queue,assist-session.service}.spec.ts`：租约恢复、重试进度、终态响应。
- `agentwiki/docs/verification/agent-clear-context-20261026/{README,release-tools}.md`：上次已发布 .61 验收。

## 本轮临时执行回执

- `/tmp/agentwiki-agent-audit-full.log`：完整门禁，8373通过/0失败/5既有跳过。
- `/tmp/agentwiki-agent-audit-build.log`：生产构建。
- `/tmp/agentwiki-agent-audit-typecheck-final.log`、`/tmp/agentwiki-agent-audit-lint-final.log`：最终静态检查。
- `/tmp/agentwiki-agent-audit-unicode-red.log`、`/tmp/agentwiki-agent-audit-finalstep-red.log`：运行时红测试。
- `/tmp/agentwiki-agent-audit-runner-final.log`：最终运行时122项通过。
- `/tmp/agentwiki-ui-audit-20261026-receipt.json`：浏览器4种语言/尺寸组合。
- `/tmp/agentwiki-reference-audit-{en,zh-CN}-{1280,390}.png`：浏览器截图。

临时回执路径可能由系统清理；持久源测试及 brief.md 记录保留验收方法、结果和边界。
