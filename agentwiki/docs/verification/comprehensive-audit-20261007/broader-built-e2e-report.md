# 广泛真实 built E2E 最终回执

跨轮去重 **31/31 PASS，0 FAIL、0 SKIP、0 flaky**；4 个追加脚本最终均 PASS。这是逐项最终验收合并，不是把重复尝试累计，也不是宣称31例在同一个最终build上全部重跑。

| Spec | 最终轮次 | PASS | Runtime | Test commit |
|---|---|---:|---|---|
| onboarding-guide | r2 | 2 | 1c5841fc | 1c5841fc |
| collaboration-reentry-layout | r2 | 1 | 1c5841fc | 1c5841fc |
| editor-language | r2 | 2 | 1c5841fc | 1c5841fc |
| markdown-core | r3 | 2 | 1c5841fc | 090e164d |
| markdown-attachments | r4 | 6 | 1c5841fc | d32f21c9 |
| space-folders | r5 | 5 | 1c5841fc | a759bfcc |
| page-templates | r11 | 10 | 8104a239 | 304aa366 |
| collaboration | r2 | 1 | 1c5841fc | 1c5841fc |
| onboarding-device | r2 | 1 | 1c5841fc | 1c5841fc |
| local-sync | r8 | 1 | 6dd46114 | 6dd46114 |

## 候选与执行隔离

旧 runtime `1c5841fc82b9bc17b559a90db49b9a33fb8781bf` 的生产/build与3fa一致；旧测试修正各commit见上表。F5/F6新构建 `6dd461146350e131221c57da4f36f508d9f965e9` 上R8 local-sync1例通过，templates Admin来源/版本强校验通过但移动焦点RED。F7最终生产构建 `8104a239217d4f050ae56876e1895c420687d860` 上R11模板10例完整通过，实际测试commit `304aa3660c88e0ab7a4cd03638999c834c0fa0ab` 仅修定位器。其间未由本执行者build或改产品。

state均读取root私有文件并检查uid/mode/live harness与commit；DATABASE_URL使用state随机独立schema。每批结束至下一开始至少65秒，workers1、Chrome独立TMP/profile；未调整auth10/min/API300/min。最终state final-green-r7-state.json，API55361/web55362。

## 真实与fixture边界

collaboration-reentry-layout为mock fixture UI（含/users/me、/review/count），不能计为真实API授权验收。其他spec使用实际runtime，个别路由mock仍以各测试具体范围为准。未把mock UI说成真实后端覆盖。

追加脚本：ui-route-smoke PASS（5 public、15 authenticated、7 mobile routes）；smoke-test PASS（32 checks）；test-space-agent-member PASS（desktop/mobile）；cross-machine-e2e 最终fd11fb92脚本PASS（真实SyncEngine，同主机隔离client homes，1 conflict、1 relation、2 approved deletions、memory0）。最后一项不是实际跨主机验收，不含新增revoke声明。

## 原始失败保留及修正分类

R1 built-browser-suite-r1.log保留原始注册429与旧合同失败。paced R2–R11每轮JSON/stderr/失败trace均独立保留，没有覆盖RED。失败trace网络未观察429；脚本输出未观察429文本；未对所有成功请求另开全量抓包。

旧测试合同修正包括：渲染根祖先、精确上传input、双目录scope、独立new路由、title blur触发preview、隐藏操作菜单展开、deep-link改为独立加载。业务、console、宽度、focus断言保留。

**F6真实RED**：R7 Admin catalog漏canCreate权限，前端错误降级普通POST/pages，丢失复合来源；instantiate本身授权允许admin。初步将其判为单纯测试合同的说法已撤回。R8修复后Admin canCreate=true、来源/版本正文强校验及复合结果页通过。

**F7真实RED**：R8最后移动例标题在异步preview期间disabled，恢复enabled后未获焦点。R9在F7新构建上该焦点已通过；其后失败是全局main命中嵌套两个main。R10精确Category label失败是嵌套select option文字影响定位。R11准确scope后全部10例通过，保留长名称、左右viewport/nooverflow、More菜单、关闭/返回焦点检查。

## 资源与截图

各spec自有fixture按afterAll清理；R2 cross-machine旧脚本unhandled rejection可能未执行finally，其残留仅旧隔离schema/TMP，已通知root由其整schema清理收口，不宣称逐fixture全清。R11执行器exit0；进程表未发现测试执行器或独立TMP相关活进程。最终root runtime随后停止，API55361/web55362、Agent IPC、随机schema和自有临时目录均经外部清理核验；两专用测试库已删除，共享PostgreSQL保持运行。

最终截图：
- `built-e2e-r11/owned-tmp/agentwiki-page-template-qa/1791334233680-22afcde8f8443/template-manager-mobile.png`
- `built-e2e-r11/owned-tmp/agentwiki-page-template-qa/1791334233680-22afcde8f8443/page-editor-more-mobile.png`

证据索引：built-e2e-r2至built-e2e-r11各results.json；built-e2e-extension-r2/results.json保留首次memory400，built-e2e-extension-r3/results.json为修正后PASS。
