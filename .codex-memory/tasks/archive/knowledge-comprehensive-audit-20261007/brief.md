# 知识能力交付全面复审

用户2026-10-07明确要求任务、代码、前后端及UI多轮全面审查和测试，修复所有值得修复问题，直到范围内无已知可行动问题。

基线e0f2d12ab5d4214c6e326affe305fdc3c609ca3f（产品ddfaf538），工作树/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki （尾空格），原分支codex/knowledge-capabilities。重点覆盖本分支165c207b以来全部实现，并做系统回归；已批准的CodeWiki排除、ACP接口-only、未部署边界保持。检索质量未证明的预批准fallback是当前有效范围，不通过篡改旧评分或反复调提示追分。

执行：三位fresh独立审查者分别核对任务/后端/前端gateway；root运行独占测试数据库和Redis全量测试及实际API/UI。发现问题独立实现、独立复审、失败场景回归。多轮结束条件为范围内任务完整、有证据的值得修复问题关闭、最终实际构建/交互验收，无零bug的全局保证。

当前：F1-F6全部完成代码修复/独立复审与实际RED→GREEN；最后F6 Admin实际通过后，模板R8最后一例390px标题焦点失败引出F7。8104a239修复模板首次ready焦点与返回列表旧preview失效（只两client文件），作者37/37和tsc通过，独立review与全client回归进行中。随后最终build和模板10例实际复验，遇新问题继续闭环。

有效回归：runtime305、DB230、server2994（6dd46114，4skip其中connection3个独立DB补跑通过）、client2166（F7后重跑中）、protocol140、local-sync985。净剩CodeGraph opt-in、Windows OpenCode及ACL三项。不得将分阶段组合伪称单次full exit0。6dd46114 typecheck/build/lint通过，F5最终实际REST/serverMCP8checks GREEN、local-sync实际UI1/1；模板9/10（最后焦点引出F7），更广跨轮30/31，4补充script已绿。

文档built真实UI、长文宽表、权限、来源、graph、Q2 fixture的完整范围见acceptance及原始证据。本轮全栈验证的真实/fixture、同主机多client/物理跨机、serverMCP/stdio边界保持。原模型收益NOT MET的批准fallback与ACP仅接口/CodeWiki排除/未部署不变。

证据 /tmp/agentwiki-comprehensive-audit-20261007。旧document-session-r2与final-green-state对应runtime都已CLEANED+外部核验，没有活跃runtime。root即将使用start-final-green-r7-runtime.py启动最终候选，state为final-green-r7-state.json。主专用DB agentwiki_audit_test_8a97562edce2和专用SyncVersion DB agentwiki_sync_version_test_audit_bc72cef1b85e尚保留，最终必须清理；其他会话资源不动。
