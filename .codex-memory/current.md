# 当前目标

- Web 新建内容导航页 v0.11.1 已发布和部署，生产浏览器验收完成；Space 自定义模板评估完成并保留。

# 范围 / 不做

- /spaces/:id/new：空白直建、模板来源与搜索、页面组分类、目录继承、固定操作栏、未提交保护。
- 应用root/server/client 0.11.1；Local Sync0.10.0、协议0.6.0、独立Obsidian插件0.5.0保持。未发布npm/插件、无数据库schema变更，未扩大线上功能开关。

# 当前状态

- master已合并推送；功能56601185，版本8525a350，GitHub Release v0.11.1；生产https://agentwiki.quukk.com已更新。
- client1458、server2605、protocol140、LocalSync924通过；runtime数据库207覆盖通过。build/typecheck/lint通过；Windows与显式CodeGraph门禁边界见发布记录。
- 生产32项smoke、真实Chrome桌面/手机尺寸的空白创建、模板筛选复用与目录继承通过；旧标签页导航通过，无相关console错误或横向溢出。
- 1073部署源码文件匹配，637旧资源保留；服务active/NRestarts0、health全ok、56成功迁移/两个env不变，239有效页面搜索与向量正常。
- 有效Space的未归档自定义模板0个、历史版本1个、现存引用0个。完整保存/版本/复用能力已实测，保留为“空间自定义”筛选；不将已删除Space记录计为活跃使用。

# 稳定约束

- Folder为目录，Page承载正文；folderId为事实源，权限/CAS/treeRevision保持。
- 主仓路径末尾空格，Git显式--work-tree；保留原根目录用户脏文件和其他工作树。
- 浏览器隔离fixture、真实生产后端、发布/部署为独立验收门槛；页面组沿用Space allowlist。

# 关键索引

- agentwiki/docs/verification/new-content-v0111-release.md
- tasks/archive/new-content-page-20260910/brief.md
- tasks/archive/new-content-page-20260910/decisions.md
- tasks/archive/new-content-page-20260910/refs.md
- 私有证据：/Users/neomei/.codex/recovery/agentwiki-new-content-20260910/

# 风险 / 下一步


- 本次发布与生产验收完成；Windows原生、真实手机硬件未在本轮重新验收。
- 配对备份/var/backups/agentwiki/new-content-v0111.dkQVlq；前版/root/agentwiki-previous-20260910034200。恢复必须匹配数据库/附件/应用/env/systemd。
