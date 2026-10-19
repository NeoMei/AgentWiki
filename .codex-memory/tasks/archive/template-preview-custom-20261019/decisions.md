# 决策

- 修复现有模板数据读取与入口，不新增模板存储模型，不改变不可变版本和权限策略。
- owner/admin 管理；editor 可选择使用；归档模板不提供使用链接。
- 新模板复用 SavePageAsTemplateDialog，从已保存 Markdown 页面建立，带源页 expectedUpdatedAt。
- 单页和页面组使用原创建接口，保留模板版本和 folder 目标。
- Markdown mode=static/canEdit=false；预览不写入页面和任务状态。
- 预览按需加载，creation.* 文案随功能加载，首屏体积门槛保持550000字节。
- 核查后活动模板上限100，分页定位不是确认的线上缺陷；保留缺失/失败提示与健壮性测试。

- 用户后续明确“发布”，执行Web/API0.12.54正式发布流程；Local Sync/protocol版本保持，不发布npm。
- 生产数据验收限定原项目只读和唯一临时私有Space写入；管理权限保持既有owner/admin边界，完成后精准软删除临时Space。
