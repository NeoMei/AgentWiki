# AgentWiki v0.10.1

状态：已发布、部署并完成公网验收。运行源88a8fe4c；不可变v0.10.1标签指向05f3de29，后续仅补充发布记录。GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.10.1 ，发布时间2026-09-09T06:19:49Z，非草稿/预发布。

用户2026-09-09授权“把问题都解决了再发布”。本版在680083e9基础上同步root/server/client为0.10.1；Local Sync0.9.1、protocol0.6.0、Obsidian0.4.0保持，不发布npm。后台业务、权限、CAS保存、同步和数据库迁移不变。

## 问题与处理

- 主工作区与5个参考子模块已干净；原资料备份保留，详见workspace-cleanup-tech-debt-20260909.md。
- 客户端测试自动构建shared/protocol，验证了旧产物和完全缺失dist两种情况。
- 首屏静态JS从约927KB降到494791字节；路由和重功能按需加载，构建强制预算。完整Mermaid解析器单块690864字节仅保留720000字节受控懒加载例外。Terser两轮压缩实验仍677KB且延长构建，未采纳；没有裁剪图表类型或提高全局警告阈值。
- 部署保留旧dist/assets中的普通文件，旧标签页后续仍可加载旧模块；新index.html及新资源保持。同名异内容、符号链接或其他非文件导致部署在停服前失败，避免覆盖已有资源。
- 本次私有操作工具统一frontend-v0101备份/rollback/stage及恢复白名单；修复审查发现的新旧命名不一致和旧恢复命令说明。两份staged/live env增加停服前字节相等检查。

## 验证

- 最终runtime非DB263pass/1skip；DB181pass/0skip；server2570pass/1skip；client1423pass；protocol140pass；Local Sync886pass/1skip。总5463pass/3平台skip/0fail。
- 完整候选回归后新增资源保留工具，独立补跑最终runtime非DB全套263pass；受影响部署/入口契约88/88。业务和DB源码未再修改。
- 全仓build/lint/typecheck通过。恢复辅助测试2/2、备份路径契约1/1、资源保留3/3通过，后两者均有失败→修复→通过证据。独立复审C0/I0/M0。
- 本地真实生产构建已验证编辑保存、checkbox回读、公式、高亮、5类图表、相关子页面和390px目录/浮窗；见前项技术债记录。
- 生产发布前1051个源码输入文件与9fc3fe5f逐字节匹配，0漂移；56个已应用迁移与候选校验和一致，0pending/unresolved；数据库/Unix socket同簇恢复预检查通过；现有三服务active、磁盘323GiB可用。

私有证据及恢复工具：`/Users/neomei/.codex/recovery/agentwiki-v0101-release-20260909/`。公网验收仅操作本版合成Space/Page；已有其他任务数据不动。灾难恢复脚本未在生产实际执行，Windows原生、所有Mermaid类型和外部Agent模型流程不在本次重新验证范围。

## 部署与公网验收

- 本地主分支额外客户端1423pass、runtime非DB263pass/1skip、全仓build通过；源与完整候选一致。
- 成套备份 `/var/backups/agentwiki/frontend-v0101.5Tt8XN` 已验证；上版应用保留 `/root/agentwiki-previous-20260909141339`。无待执行迁移。
- 1411个部署输入及新版产物文件与候选逐字节一致；旧版262个静态资源全部匹配，新增保留104个文件。两份生产env与备份字节一致；root/server/client0.10.1、Local Sync0.9.1。
- API/worker/frontend全部active/running、NRestarts0；公网health五项全部ok。
- 发布前新开旧版文章标签页，未加载编辑器；发布后不刷新，禁用缓存下请求旧PageEditor-D0bQOS3r.js获得200（非磁盘缓存），成功进入编辑并保存OLD-TAB-SAVE-V0101。
- 新版页面实际编辑并保存NEW-TAB-SAVE-V0101、checkbox[x]；独立owner API GET确认两个标记及勾选。预览、返回阅读、公式、代码高亮、流程图/时序图/架构图均成功。
- 桌面与390px目录抽屉、三层目录、右上浮窗通过，无横向溢出；两个标签页console错误/警告为空。浏览器通用viewport未作用于公网tab，改为该tab的CDP视口完成390px验证，结束时视口与缓存覆盖均已清除。
- 仅本次合成Space/Page与账号被清理；独立生产DB只读确认账号已删除/不可用，Space软删除。公网界面恢复工作台。
- GitHub Release发布后仅补充记录；没有npm、协议或Obsidian发布。
