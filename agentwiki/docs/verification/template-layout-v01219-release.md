# v0.12.19 发布与生产验收

2026-10-13（Asia/Shanghai）正式完成 GitHub 和生产发布。

## 发布身份

- GitHub：[AgentWiki v0.12.19](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.19)，正式 Release，非草稿/预发布。
- 发布 tag 及源码提交：`654731b15d507c4defa24ef82f0708eb178b5a07`；master 已快进纳入，未强推。后续回执提交只改文档，不移动发布 tag。
- root/server/client 均 `0.12.19`。Local Sync `0.11.0` 与协议 `0.6.1` 保持，本次未发布 npm 或独立 Obsidian 插件。

## 精确提交门禁

完整独立 checkout 安装 frozen lockfile、全仓 build、test:full、typecheck、lint 全部退出 0。

| 范围 | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| runtime | 309 | 1 | 0 |
| 专用数据库 | 230 | 0 | 0 |
| server | 3077 | 4 | 0 |
| client | 2254 | 0 | 0 |
| sync-protocol | 140 | 0 | 0 |
| local-sync | 985 | 1 | 0 |
| 合计 | 6995 | 6 | 0 |

跳过为既有平台/独立门禁限制。首次临时导出缺少 Git 元数据及父目录操作手册，造成两项环境失败；补齐完整仓库后全仓重跑通过，源码未因此调整。全门禁独立数据库与 Redis 已清理。构建保留既有大分块提示。

## 备份与部署

- 停止 API/Worker 写入后，同批备份数据库、完整附件快照、path/size/SHA256 manifest 和应用归档；dump TOC、归档可读性、manifest 与实时附件一致性、二次 manifest 及所有备份哈希通过核验。
- 备份：`/var/backups/agentwiki/template-v01219.p0KtBBrm`；database dump 37,321,217 字节，application archive 348,759,091 字节。
- 使用现有 deploy.sh 分阶段构建并切换；61 个既有迁移，无待执行迁移。
- 旧应用保留在 `/root/agentwiki-previous-20261013023338`。回滚需遵守配套数据库/附件恢复流程，不单独重新启用旧应用。

## 生产回读

- 1240 个部署源码/配置/fixture 文件逐个 SHA256 与正式提交一致。
- API、Worker、Frontend 都为 active/running，NRestarts=0；内外网 status/database/redis/auditPersistence/attachmentStorage 五项均 ok。
- 两份生产环境文件部署前后 SHA256 不变。
- 公网5个当前入口资源与精确候选 build 完全一致；旧版本5个入口资源仍可访问且哈希未变，保留旧标签页兼容。
- 正式公网 smoke-test 32 项通过；脚本 finally 清理自有账号、Space、Agent 等资源后才返回成功。
- 已登录 Chrome 读取真实模板目录、协作模板与编码启动页、现有需求文档；新入口为 `assets/index-ha_aWycH.js`。桌面与390px下无整页横向溢出，文档宽表格局部横滚，标题正常显示。启动页与文档页无新增控制台 warning/error。
- 浏览器没有保存文档、创建模板/页面、改角色或启动实际 Agent；本次真实写入验收仅限烟测自有资源。不会把页面可见等同于 Agent 已执行。

## 审查

元数据、完整门禁及部署后回执分别由独立代理复核：GitHub tag、Release、候选源码、服务器及公网资源一致；全部本期发现关闭。原检出分支和既有未提交研究资料保持。
