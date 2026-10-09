# 隔离 Tiptap Markdown 探针

从 AgentWiki 仓库根运行：

```sh
sh agentwiki/docs/verification/document-workspace-20261006/visual-editor-probe/run.sh
```

脚本在新的 `/tmp/agentwiki-visual-editor-probe.*` 目录安装依赖并执行，不改产品源码、依赖声明或锁文件。当前仓库须已安装 client 与 sync-protocol 依赖，探针直接导入真实 `obsidian.ts`。可用 `AGENTWIKI_REPO` 指定仓库，用 `PROBE_OUTPUT` 指定输出目录。默认输出不会覆写本目录归档证据。

- `fixtures.json`：17 个原文 fixture，包括 CRLF、YAML、HTML、脚注。
- `probe.mjs`：MarkdownManager 与 jsdom Editor 往返、实际增列/图片属性/任务操作、局部编辑与 undo、原文保留 guard。
- `results/summary.json`：机器可读结果、源码哈希和版本。
- `results/<fixture>/`：input、output、diff、JSON 与现有 remark 前后 AST。
- `runtime-packages.json` / `probe-run.log`：实际安装与执行 receipt。

严格 AST 对比与意义等价对比分开：后者只忽略资源 source offset、展开普通引用式链接定义，不忽略数学显示类型、脚注或未知语法。此探针不是浏览器/原生 IME 验收，也没有产品 UI 或 CRDT。
