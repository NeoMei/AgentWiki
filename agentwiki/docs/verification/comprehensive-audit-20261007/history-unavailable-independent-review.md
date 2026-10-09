# 补充与不可用历史独立复审

结论：PASS。两次 operator 校正符合现行服务端合同，未绕过已证实的来源泄露。仅只读源码、脚本、trace 与回执，未操作 API/浏览器/runtime。

- 404 → 400 正确：assist-session.service.ts:15 的 InaccessibleSessionException 继承 BadRequestException；:188 在已有会话的引用归档后因 deletedAt/live Space 检查拒绝返回。不存在或非本人会话才由 :172 返回 NotFoundException。list 在 :51 捕获来源不可用并省略整个会话，防止标题引用原内容。
- sessionID 回显不是泄露：all-exceptions.filter.ts:165 明确 path=request.url。调用者自己提交的 /assist/sessions/<id> 被错误 envelope 回显，不能作为从服务器新获得历史数据的证据。最终校验仍要求 list 无旧 sessionID，并在 detail+list 两响应中禁用旧 referenceID 与旧 quote；没有把真正引用标识或内容加入例外。
- 原 GH9BqX trace 的浏览器网络包含旧 session 的 200 list/detail，配合原两项检查证明归档前历史可见及只归档自己的 reference。G6wBst trace 明确 GET /assist/sessions?spaceId=... 返回 200 []，成功四项检查包括 UI 无旧 turn/option/quote，以及另行授权的主页/兄弟页正文仍为预期。Node fetch 的直接 detail 错误响应不在浏览器 trace 中；其状态/内容保证来自成功执行脚本断言与现行源码，不能声称 trace 存有完整 detail response。
- supplement-1791330348643 为 PASS：真实跨页续问的 provider historySources 包含旧主页；人工覆盖候选目标后 UI 冲突且草稿保留、正式新页仍 seed；Stop 对应同 promptHash 的 started → terminated，无 completed，fixture-process-events 独立核对一致。该 receipt 中 officialUnchanged=false 是复用 helper 的 saved=true 标志，实际断言比对已保存预期，不能解读为补充期间发生了正式正文写入。

范围：真实 built UI/API 配合明确的确定性外部 provider fixture，不是真实模型质量验收。此处检查的是归档导致历史不可用，不能代替其他账户/Space 撤权矩阵。两轮失败证据均保留，无产品改动。
