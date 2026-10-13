# v0.12.26 发布验收

发布候选：`e3bbc2012b65ccf2ccba18724c43657989614528`。最终门禁与独立复审通过；GitHub master/tag已推送，GitHub master/tag已发布；生产部署与公网回验通过；npm 0.13.0仍等待发布者安全密钥验证。

| 门禁 | 结果 |
|---|---|
| Client全套 | 2467通过；版本变更后定向77通过 |
| Server真数据库完整套件 | 3163通过，4既有跳过 |
| Runtime非DB | 309通过，1既有跳过 |
| Runtime DB 61文件 | 239有效通过，0跳过 |
| Protocol | 140通过 |
| Local Sync | 998通过，1既有跳过 |
| 类型/lint/build | 全部通过 |
| npm候选安装 | 空目录+公开协议0.6.1通过，两个Publisher接入路径/16 scopes/篡改拒绝通过 |
| 协议公开包 | 本地与registry0.6.1字节一致，不重复发布 |

不重复计数共7316通过、6既有跳过；定向77与打包prepack复跑另计，不虚增全量总数。

## 如实保留的修复/补验

- 首次Local Sync旧source-lock测试把自身PID误判死亡，负载下清除自产ticket。确定性对照确认后仅修正测试注入，定向29项及完整998项重跑通过，生产锁未改。
- 升版门禁发现E2E/环境示例及测试正则仍引用旧版本，已补齐；最终runtime309和client版本77重跑通过。
- 首轮DB233通过、1项因专用库命名安全检查拒绝环境；符合正则的新隔离库定向补验6通过。不是一次全绿运行，不重复计数。
- 专用数据库、Redis、临时数据全部清理；数据库真HTTP/MCP笔记7项包含在239中。

范围：单行选区、编辑图片、共享笔记/作者权限/常驻高亮图标/行内添加、统一工具栏、Agent聊天、Space Owner全部包含。实现范围与发布版本增量已独立复审无阻断。

本地门禁详见 [门禁阶段](gate-results.json)、[数据库回执](db-gate-final-receipt.json)、[安装包候选](npm-candidate.json)。线上验证稍后按实际结果补齐。


## 生产回验

- 生产源码1,297文件匹配候选；3服务 active；API health 的 database/Redis/audit/attachment 均 ok。迁移 `20261014220000_shared_page_notes` 已完成，生产配置 `LOCAL_SYNC_PACKAGE_VERSION=0.13.0`。
- 公网 `smoke-test.mjs`：32/32通过。临时生产空间的共享笔记 REST/MCP 7项通过，含Owner字段、跨作者拒写、MCP四工具发现与调用、Agent降权即时生效、正文不变。
- 临时账号、空间、页面、Agent及附件已按精确 nonce 清理；清理为API撤销、附件归档和Space/Page软删除。
- 首轮图片验收脚本使用 `assets/...` Markdown目标被服务端正确拒绝（`ATTACHMENT_REFERENCE_INVALID`），按正式Wiki图片引用协议修正后重跑通过；该失败与产品实现无关，已保留回执。
