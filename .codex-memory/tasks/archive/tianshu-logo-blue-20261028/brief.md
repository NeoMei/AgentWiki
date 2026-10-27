# 天枢标志改为主站蓝色

状态：已随 v0.12.64 发布部署，冻结 190ba1b3。生产真实Chrome验证#155DFC像素与资源hash通过。

用户要求按 Quukk 主站天枢产品标志改为蓝色。使用主站 `#155DFC` / `oklch(54.6% 0.245 262.881)`，更新页面标志、64px 标签图标、180px touch 图标及兼容 favicon.svg；保留旧资源与未跟踪设计草稿。

验证：6 个相关测试文件 74 项通过；client TypeScript/Vite 生产构建、定向 lint、diff-check 与发布 guard 通过；桌面 1280×900 和手机 390×844 的首页及导航到指南检查通过，无横向溢出、空白页、错误覆盖层或相关控制台异常。256px alpha 与原图逐像素相同；三图预乘颜色误差为零，独立复核通过。

初次改色阶段 UI 验收使用 bsk Agent Window，未更改登录态或写入业务数据。登录/注册页复用同一 BrandMark，相关现有测试通过。后续 v0.12.64 发布阶段通过隔离生产账号真实Chrome验收，logo资源hash和#155DFC像素验证通过；证据见 notes-release-v01264-20261028/production-browser.json。
