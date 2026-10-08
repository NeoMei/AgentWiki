# 实施期间裁决

Ruling: 沿用项目当前组件风格，不引入新UI库 — 本次修复不是视觉重做 — 如判断不符只需调整呈现。

Ruling: 来源/运行使用同页双视图且兼容旧链接 — 满足去重复并保留现有操作 — 若用户偏好不同可再改导航。

Ruling: 实施子代理串行，独立只读诊断并行 — 避免共享文件冲突 — 时间成本由诊断并行抵消。

Ruling: Task 6 in independent plugin worktree may implement concurrently with main web tasks — repositories, interfaces and commits do not overlap; cross-product acceptance remains Task 7 — if hidden contract overlap arises, serialize and re-review.

Ruling: Task 2 also uses a separate managed worktree and no Task 1 files — independent editor/session changes can run while directory work proceeds — integration is sequential after task review; conflicts would require re-review.

Ruling: Task 4 can prepare in isolated collaboration worktree before Task 3 — task4 reviews use existing run.canDecide and source provenance, not template-write capability; any newly required capability must wait for Task3 contract — sequential integration/review catches overlap. Existing permissions must remain unchanged.

- 本次范围是已验收的本地候选，保留隔离分支和工作树；没有推送、合并主分支、发布或部署。
- 整分支发现插件新增提示缺英文，最后只补同条提示中英文，不引入新的插件国际化系统；若用户希望语言切换，需另按插件语言架构实施。
- 全量测试发现两类陈旧断言：顶层Runs入口和应用版本0.12.12；修正测试以验证新导航及三应用版本一致，独立同步包约束保留。产品版本、依赖均未改。

- 保持550000字节首屏预算；只把协作lookup移到按需加载范围，保留全部225条映射及双语各229条翻译。原全仓与最后增量验证身份分列，不冒称最终SHA重跑过不受影响的数据库全套。
