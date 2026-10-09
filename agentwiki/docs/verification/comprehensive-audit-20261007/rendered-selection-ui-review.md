# 阅读态选文实际验收

PASS，候选 1c5841fc82b9bc17b559a90db49b9a33fb8781bf。真实 built 页面、独立 Chrome/context、正常 UI 登录；明确确定性 provider fixture，并非真实模型。

- 等待段落 visible 后，以真实 mouse triple-click 选择普通渲染段落“把分散的信息整理成清晰、可持续维护的知识。”，未使用DOM Range造选区或注入内部状态。
- 只读浏览器 selection 包含段尾两个换行；产品安全映射后的引文恰为原始正文段落，添加个人笔记、选中并 stage 全程 assist POST=0。
- Explicit Send 后建立全新 session，未使用不可用旧会话。返回 turn 的 pageId、全文snapshot、updatedAt、唯一annotation正文及quote全部等于预先读取的expected-final和实际发送前版本。
- 问答完成后独立HTTP确认正式正文及updatedAt均未变化。
- trace.network只有两笔assist POST（create session及turn），均发生在发送时刻之后，返回201。截图01/02/03、trace.zip、receipt.json保留。
- 自有context/browser在finally关闭；未修改产品/build/runtime/数据库，也未恢复归档reference。

首轮reading-u3cMUZ因runner未等待正文ready失败，原证据保留；本轮仅补DOM visible等待，不改变内容预期或安全断言。

覆盖限于可安全映射的普通渲染段落。复杂装饰或非唯一片段可能需产品提供的只读原始Markdown选区回退；本轮未触发/测试回退，不宣称任意富文本选择都能映射。
