# 文档全页布局 — 已完成

2026-10-06，按用户要求继续参照OpenKnowledge，让文档查看/编辑占满页面区域、观感自然。基线fa6e8dbd，产品提交1991cc89，分支codex/document-workspace；未合并、push或部署。

## 已交付

- 仅阅读/编辑路由移除灰色外框、重复padding和860px文章宽度上限，沿用现有Space导航/目录/CodeMirror，连续全宽白色画布。
- 桌面32px、手机16px边距，正文/编辑器16px与1.8行高，自然高度标题，去掉旧分隔线和过大标题空档。
- >=1600px的实际打开大纲/协作面板预留空间；关闭、抑制、无大纲及中宽/手机释放占位。
- 协作面板跟随实际toolbar底边+12，响应换行、滚动和窗口尺寸，不遮保存/预览；手机目录按钮单行、面包屑独占一行。

## 验收

- fresh实现与独立review，所有相关代理实际p5c07ff/gpt-6-astra/ultra。11文件diff SHA-256 2f199e4bd5ddaae2e97fb00c197d8b50b05f5a32f0122a40c67bdf28c0f375bb；独立审查Ready Yes，无未关闭问题。
- 135client suites / 2016tests通过，增加10个行为测试；最终client生产build含tsc通过，局部eslint和diff check通过。初始JS548658/550000（+82B），未放宽预算。
- 真实API+最终production dist浏览器1280/1600/390验收：正文796→952px（1280），目录宽度/收起/切页，面板resize/关闭/顶部避让，手机工具栏/路径/文章跳转/内部表格滚动，版本页布局隔离均通过。console error为空。
- 编辑选区经预览往返保留；临时输入并Undo后编辑器复制全文3524字符与原文严格相等。原有dirty布尔仍显示修改，按正常导航确认退出，全程无Save。
- 最终DB及真实API主/兄弟两页title/content/updatedAt全未变。11:54:08Z独立清理确认本次schema、进程、launchd、Redis/uploads/temp、凭据清除，public inventory未变；浏览器退出、tab关闭、viewport reset。
- 原主目录未改，既有untracked agentwiki/docs/research/仍保留。

## 边界

同源favicon测试fixture按既有Markdown资源策略显示Image unavailable，不计为图片加载验收。未做Windows/原生IME/外部provider验证；现有Mermaid大chunk提示及parser例外未变。

本轮截图、验收/审查和运行回执保存在/tmp/agentwiki-layout-20261006，未将临时素材写入仓库。
