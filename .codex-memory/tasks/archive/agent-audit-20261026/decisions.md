# 决策与修复记录

- 维持现有权限、写入授权和来源隔离约束，不以绕过验证来消除失败。
- 每个问题先用失败测试确认根因，再验证修复；不同代理交叉复审最终差异。
- 本轮不修改原 Bug 汇总表，不操作其他生产用户会话，不发送模型请求。修复未发布。
- 第一轮定位会话异步结果覆盖、来源失效分类与回执隔离、运行重试残留、UI 会话错误/焦点、UTF-8 流解码问题。
- 第二轮扩展生产 DTO 转换、最终 assistant step 完整性、cancel 成功与 poll 同批到达、跨 Space 导航边界，补齐红绿回归。
- 第三轮独立复审发现 cancel 权限失败后旧 poll 可恢复历史；401/403/源失效400 三个测试先红后绿，access fail 同步作废已有读取。修复后复审未发现新增 P1/P2。
- 第四轮不同审阅者复查最终 hook、Panel、ReferencePicker 交互，未发现新的可复现问题。检查取消/切换/失权、保存回执、批注去重和 Portal 焦点。

| 位置 | 根因与修复 |
|---|---|
| OpencodeCliRunner 输出 | UTF-8 字节被拆在多个 pipe chunk 时逐块转字符串产生乱码；改用 StringDecoder 连续解码，并在 EOF flush。 |
| OpencodeCliRunner 结果 | question/proposal 曾合并或回捞前一 step 的有效结果，掩盖最后一步为空、工具未完成、JSON 破损、输出截断；统一会话模式最终 step 判断，保留 legacy 无 mode 协议。 |
| useAgentSession 读取 | 同一 epoch 的重叠读取缺少先后顺序；增加 readRequest，旧成功和旧失败均不覆盖新状态。 |
| useAgentSession 取消 | effect 清理晚于同批到达旧 poll；cancel 成功或 access fail 均同步失效旧读取。 |
| useAgentSession 来源 | 真实目录失效400曾落到容量错误，保留已失效历史；纳入 access 清理。 |
| useAgentSession 回执 | 单会话400/404清空其他会话保存回执，导致完成记录无法协调；限定清理对应会话。401/403仍全清。 |
| AgentSessionPanel | 会话切换残留上次本地验证错误；错误按 selected 清理，事件去重依然仅按 scope 重置。 |
| AgentReferencePicker | Portal Tab 顺序不随页面且失焦到浏览器时未关闭；边界返回触发器相邻控件，空 relatedTarget 关闭但不抢焦点。 |
| AssistQueue / SessionService | 租约恢复及重试保留旧 progress/result；恢复/claim 清理，只有 running 对外展示 progressText。 |
| Assist DTO | 生产 enableImplicitConversion 先把非字符串变成字符串绕过类型校验；相关字段保留原输入，实际 ValidationPipe 拒绝无效类型。 |

不把普通“目录在发送时变化、需重试”的捕获冲突当成已存会话来源失效；它不证明现有历史不可访问。
