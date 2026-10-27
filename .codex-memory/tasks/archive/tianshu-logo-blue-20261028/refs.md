# 证据

- 主站颜色：https://www.quukk.com/product-shots.css?v=20261026-xuangene-logo ，选择器 `.showcase-wiki .product-logo`。
- 原图：https://www.quukk.com/assets/agentwiki-knot-v1.png 。主站通过 mask 染蓝，源 PNG 本身为旧红色。
- 实现：`agentwiki/apps/client/src/components/BrandMark.tsx`、`agentwiki/apps/client/index.html`、`agentwiki/apps/client/public/brand/`、`agentwiki/apps/client/public/favicon.svg`。
- 测试命令：`pnpm --filter @agentwiki/client exec vitest run src/components/Navbar.spec.tsx src/features/about/ProductPage.spec.tsx src/features/about/UsageGuide.spec.tsx src/features/about/OnboardPage.spec.tsx src/features/auth/Login.spec.tsx src/features/auth/auth-form-validation.spec.tsx`，6 文件 74 项通过。
- 构建：`pnpm --filter @agentwiki/client build`，初始 JS 550990/551000；保留现有 Mermaid chunk 提示。
- 临时视觉证据：`/tmp/tianshu-logo-blue-desktop.png`、`/tmp/tianshu-logo-blue-mobile.png`、`/tmp/tianshu-logo-blue-guide-mobile.png`。
- 独立检查：256px alpha 全等、64/180 尺寸正确、白底合成颜色误差为零、SVG 内嵌 PNG 与 v2 favicon 字节相同，旧 6 个 PNG 未改。
