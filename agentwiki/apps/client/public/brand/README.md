# 天枢标志

当前资源为 `agentwiki-{knot,favicon,touch}-v2.png`，尺寸分别为 256、64、180 像素。

颜色与 Quukk 主站天枢产品标志一致：`#155DFC` / `rgb(21 93 252)`，主站 CSS 使用 `oklch(54.6% 0.245 262.881)`。

颜色来源（2026-10-28 核对）：https://www.quukk.com/product-shots.css?v=20261026-xuangene-logo 的 `.showcase-wiki .product-logo`。

v2 按主站相同的透明蒙版着色方式导出。256px 标志保留 v1 的逐像素透明通道，三种尺寸的预乘透明通道颜色均与主蓝色一致。`../favicon.svg` 内嵌同一张 v2 64px PNG。

UI 通过 `src/components/BrandMark.tsx` 统一使用；标签页和触屏图标由 `index.html` 引用。v1 与旧 `tianshu-*` 别名保留，供历史页面和回滚使用。
