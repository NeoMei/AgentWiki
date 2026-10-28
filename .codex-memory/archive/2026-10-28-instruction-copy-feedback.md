# 协作指令复制按钮样式与反馈

用户截图指出创建完成页复制按钮粗糙且没有成功反馈。基线bd58b522，生产v0.12.64不变。本次按明确可逆的小修复处理；后续随v0.12.65发布部署，线上结果页实点边界见space-review-release-20261028发布任务。

根因：NewPageDialog与PageAgentBindingDialog两处相同按钮直接void调用clipboard.writeText，不捕获结果；border未指颜色且控件偏大。抽feature级InstructionCopyButton统一两入口，显式轻灰边框/浅背景，桌面32px、手机44px。复制完整原指令，await成功后Check+已复制+可访问status，3秒复位；拒绝或缺失API显示alert并允许重试。按text隔离组件，卸载后忽略旧pending，保留用户手选指令，未改变Agent指令内容或启动行为。

验证：先补两个真实入口回归，红灯为找不到已复制；实现后3个文件59/59通过。另client tsc、定向ESLint、生产build通过；初始JS550520/551000，不抬预算。独立代理复核无阻塞。

本地真实Chrome7项通过：实际NewPageDialog/BindingDialog组件，经内存API fixture进入结果页；真实clipboard写入/读回完整原文、Enter键、成功复位、拒绝提示/恢复后重试、390px/44px无横溢、两个入口、无console/runtime/overlay错误。隔离profile，无业务服务写入。Browser插件未列出，使用常规Playwright。临时preview server与浏览器已关闭，未触用户profile。

证据均在仓库外：/tmp/agentwiki-copy-button-qa/{receipt.json,desktop-before.png,desktop-copied.png,desktop-failed.png,mobile-copied.png}；/tmp/agentwiki-copy-{entry-red,green,types,lint,build,browser}.log。初次隔离预览遇到虚拟TSX未转译及harness缺favicon，已修正夹具后7项全过；不是产品失败。用户design/原位保留。
