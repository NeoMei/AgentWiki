# 复测反馈第二轮修复候选

报告： https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32 ，读取版本 2026-10-16T10:54:37.034Z。原报告其余14项保持用户“复测已修复”的结论。

本轮六项已有代码修复、独立审查与本地验证。最终整仓门禁已通过。尚未合入主分支、推送、发布、部署或安装日常插件；Windows Obsidian 原环境仍待验。

## 六项处理

| 报告项 | 原因与处理 | 已有证据 / 边界 |
| --- | --- | --- |
| #1 Obsidian 基线损坏 | 删除映射只移除设置、遗留同设备同Space的旧根基线；改为归档完整控制目录，以持久化意图和settings做中断恢复。未完成事务拦截，严格身份/哈希保留。 | 原问题链本地可复现；插件1478全测与独立37定向通过。不能据此断言Windows不兼容，Windows/native原环境仍待验。 |
| #2 个人单页仍英文 | 普通单页默认workflow已有英文存储文字，但个人/Space模板缺显示来源标记；根据运行冻结定义识别默认流程（包括合法null），前端显示中文。 | 个人/Space×running/completed合法schema回归；显式自定义flow、Agent名字保留。初版null遗漏已独立发现、补修复审。 |
| #12 编辑目录高亮上一条 | 滚动margin和监听坐标不一致；虚拟化让前面标题不可测。统一可见边界、采用CodeMirror高度映射，点击后随布局稳定并在实际滚动时释放。 | 原报告全文本地哈希一致回放，点击#12正文与高亮一致；合成长短文、重复/折叠/文末、1440/390px 4项E2E通过。 |
| #13 删除关系难找 | 按钮藏于折叠证据内且只有小图标；改为每条关系常显中英文文字按钮，保留确认、权限及真正relation ID。 | Chrome确认删除合成关系4→3、38个页面不变；中英390px无横溢；失败保留上下文。 |
| #17 其余必填toast/空格误过 | 客户端校验未统一、字符串只验长度；统一全部必填行内错误/首错聚焦，前后端拒绝纯空白。 | 全空、视觉顺序聚焦、数字key、0/false、可选输入及中英文验证通过。 |
| #19 日期漏今天/混入后一天 | PostgreSQL将timestamptz参数与UTC值timestamp列隐式按session时区比较，发生偏移；只转换参数为UTC timestamp，保留半开区间。 | 真实PG跨session时区/DST/毫秒边界；真实UI→ReviewService→PG单日只返回当天0点/中午/最后1ms，次日0点和3点被排除。 |

## 候选与审查

- Web基线 `35f73159`（v0.12.44）；产品与回归最终提交 `07d6abc976efdadf9b755793e5682bcf982a7df3`。分支 `codex/retest-feedback-20261016`，工作树 `/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki `（尾空格）。
- Web四组任务独立审查及fresh整分支审查PASS，无未关闭阻断项；见 [final-web-review.md](final-web-review.md) 与各 task review。
- Obsidian源码 `85b40785e00b8fc78d17837946e11728c69e4af4`，验证文档 `f7b4c3f26d986c6bfbfed08725d5dc116c0dc40a`，基线0.5.9 / f9004ff。独立审查PASS；工作树 `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/retest-baseline-20261016`。
- 插件候选包保存在上述插件工作树 `releases/retest-feedback-20261016/agentwiki-obsidian-retest-candidate-85b4078.zip`，SHA-256 `cdea1c24114c95c89a3f6a5e495949203e2a33e0f52b2a9f6562ff7301ad3907`。包内manifest仍为基线0.5.9，尚不是正式新版本，不覆盖当前安装。

## 验证与原案边界

- Web typecheck、lint、build均exit0；初始JS 548270/550000字节。
- 最终 Web `pnpm test:full`：exit 0，7624 passed / 6 既有 skipped / 0 failed（runtime309/1skip、真实数据库239、server3281/4skip、client2657、protocol140、local-sync998/1skip）。日志 `/tmp/agentwiki-retest-full-tests-final.log`。
- Obsidian：71 files / 1478 tests；独立聚焦37；typecheck、lint（19既有warnings）、format、build、check:bundle、diff check通过。最终bundle重建哈希一致。
- 第一轮全仓仅图谱两个用例过早操作派生节点失败；基线复现其中拖动竞争。两处改等真实节点，保留原断言，修后client2657及图谱43通过；最终整支再跑完整harness，不掩盖初次失败。
- 浏览器过程与证据边界见 [browser-acceptance.md](browser-acceptance.md)，合成截图 task-1-browser-390.png / task-3-browser-390.png / task-4-browser.png。
- 本地浏览器、Vite、日期HTTP bridge已关闭；日期独立数据库已删除并回读0。全仓harness管理自己的临时数据库和Redis。
- 原报告全文、原站debug与原案截图只保留 `/tmp` 私有副本，不提交公开仓库；未改生产页面内容或用户Vault。

## 后续集成

候选已通过最终门禁，可进入发布准备。Web生产回验与插件正式版本发布/原Windows复测分别记录；插件另有独立聊天在做远端归档恢复，发布前需整合审核，不能覆盖该工作树。
