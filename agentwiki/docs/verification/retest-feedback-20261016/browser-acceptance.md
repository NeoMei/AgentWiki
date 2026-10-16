# 本地真实浏览器验收

环境：Chrome 155.0.8059.40，BrowserSkill 自有 Agent Window。生产报告只读；候选通过 localhost Vite 加载真实产品组件。以下是本地候选证据，未发布、未部署，不代表 Windows 原环境通过。

## #2 / #17 协作

- 中英文全部必填为空时一次显示 4 个行内错误，首焦点为运行名称；填写名称后，纯空白工作说明/范围仍拒绝，焦点按视觉输入顺序进入工作说明，而不是数字 key 字段。
- 合法填写后真实组件发出 inputs：范围、工作说明、count=0、enabled=false；可选 note 不发送。
- 中文默认流程在历史运行显示中文，Agent 名称与显式自定义流程文字保留。该 fixture 模拟 API；真正 server provenance 由合法 schema 的 personal/space × running/completed 回归补充，审查发现的 collaboration:null 遗漏已修复并复审。
- 英文 390 CSS px，scrollWidth=390，无横向溢出。截图 task-1-browser-390.png。

## #12 目录

- 生产只读复现：点击报告第 12 条，正文已到目标但 aria-current 仍为第 1 条。
- 候选本地加载原报告全文 29,504 字符；编辑器文档 SHA-256 与本地源完全一致（d94f4fef6ba7532d9609a745565cce79ccaebbec734ad5741dcf5f72ff8cc924）。原文、截图和调试包只留 /tmp 私有文件，不入仓库。
- 点击第 12 条后 aria-current 为第 12 条，目标顶部 108.26px，工具栏底部 98.00px，目标可见。再向上滚轮后高亮转为前文所在标题，未锁死。
- 合成长文自动浏览器回归另覆盖 1440/390px、软折行、同名标题、折叠、文末与短文，共 4/4。

## #13 图谱

- 英文桌面选中合成世界观页面，证据详情未展开时删除按钮直接可见。确认删除指定关系后关联数 4→3，图谱仍为 38 页。
- 中文与英文 390 CSS px 均 scrollWidth=390；三个剩余关系的文字删除按钮均存在且证据 details 全部 false。中文按钮宽约 85.8px，英文约 120px。
- 截图 task-3-browser-390.png。删除只操作合成关系。

## #19 日期

- 生产只读复现 Asia/Shanghai 选择 2026-10-14 单日，请求已是正确 UTC 半开区间，但含次日凌晨记录。
- 候选使用真实 ReviewPage → 本机只读 HTTP bridge → 当前 ReviewService / AuthorizationService → 独立 PostgreSQL 数据库（完整迁移），使用 6 条合成边界记录。
- 实际 UI 选择单日后，请求 [2026-10-13T16:00:00.000Z, 2026-10-14T16:00:00.000Z)，仅显示当天零点、中午和 23:59:59.999 三条；前一日最后一毫秒、次日零点和凌晨三点均被排除。
- 截图 task-4-browser.png。独立数据库 agentwiki_retest_browser_test_20261016 已删除并回读 count=0，HTTP bridge 已关闭。临时日期 fixture 与 bridge 仅保存在 /tmp。

## 清理与私有证据

BrowserSkill 会话 nuys 已停止，未操作用户已有标签。最终 debug 包 /tmp/agentwiki-retest-candidate-browser-private.json；生产复现包 /tmp/agentwiki-retest-20261016-production-debug.json。它们可能含原报告业务内容，只作本地证据。测试不修改生产原报告或状态。
