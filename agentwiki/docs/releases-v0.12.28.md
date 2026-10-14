# AgentWiki v0.12.28

本版修复文章目录切换触发整页刷新，以及编辑器阅读预览中无法添加页面笔记的问题。

## 变更

- 目录导航复用当前工作区数据，切换文章时保持单页应用体验，不再触发整页刷新。
- 编辑器切换到“阅读预览”后，可以像编辑模式一样选中文本并添加页面笔记。
- 预览选区通过渲染版本和 Markdown 字符偏移校验，笔记准确绑定到原文位置；添加笔记不会修改页面正文。
- 独立页面阅读模式的笔记能力保持不变，服务器端笔记继续对所有具备访问权限的用户和 Agent 可见。

## 发布范围

- Web/API：`0.12.28`
- Local Sync：保持 `0.13.0`
- 同步协议：保持已发布的 `0.6.1`
- 无数据库迁移，不发布新的 npm 包。

## 验证

- 客户端定向测试：265 项通过。
- 客户端全量测试：151 个测试文件、2469 项通过。
- TypeScript、lint、生产构建通过。
- 生产发布前已完成页面阅读模式与笔记入口的浏览器检查；线上最终验收将在部署后执行。
- 相关提交：`a5783807`、`15e571dd`。

## 生产部署回执

- 2026-10-14 13:44（Asia/Shanghai）已部署到 `root@113.249.120.24:/root/agentwiki`。
- root/server/client manifest 均为 `0.12.28`；API、Worker、Frontend 均为 `active/running`，`NRestarts=0`。
- 公网 `https://agentwiki.quukk.com/api/health` 返回 `status/database/redis/auditPersistence/attachmentStorage: ok`。
- 公网入口资源 `/assets/index-C4AbKiQ2.js` 与服务器 `apps/client/dist/assets/index-C4AbKiQ2.js` SHA-256 一致。
- 发布后浏览器只读回读确认：页面阅读模式、编辑器内“预览”模式均显示页面笔记面板；未执行保存或其他业务数据写入。
