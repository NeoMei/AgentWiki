# Agent 真实知识检索与使用

用户已批准能力增益方案实施。本规格是已批准检索方向的最小落地，不新增CodeWiki或搜索系统。

## 产品目标

让真实Agent通过单一Local Sync网关发现参数、搜索知识、读取依据并回答跨页问题。先固定语料和旧行为基线，再改善工具可发现性与读取指引；只在基线证明响应膨胀需要时增加上下文接口。

## 范围与契约

- 现有gateway普通wiki工具只有spaceId/__args，读工具需展示命名参数。覆盖list_spaces/list_pages/search_pages/get_page/list_graph/list_sources。保留旧__args ABI；直接与包装参数冲突拒绝，禁止不同Space混合。
- 新schema必须与当前远端上限相同：search query非空/limit整数1–50；list skip非负整数/take整数1–100；get_page pageId非空；graph/sources需要Space。selector解析继续交给现有Space-scoped bridge，不新增凭据。
- skill新增使用现有知识的流程：发现Space、小批量搜索、读正文与证据、按需关系导航、区分事实/推断/不足、引用pageId与来源版本；保留全部扫描上传确认流程。
- 基线与改进均使用生产API+实际stdio gateway，消费者为fresh真实模型会话，不能用固定输出fixture模型充当效果证明。
- 固定8类测试问题：精确名、中文别名、跨页关系、相近干扰、旧新冲突、证据独有信息、无答案、无权同名诱饵。以本仓库可核对的架构规则构造合成知识，不用真实私密用户资料。
- 至少2个独立身份/聊天，前后各2场，相同问题/知识版本/模型和工具预算。记录工具真实请求/结果、引用、错误、响应字节、耗时；token未知时标unknown。消费者不得读fixture或答案文件。
- 主指标为8类题正确且引用可追溯；改进不得增加错误/越权。若基线已有满分，仅可声称参数可用性/成本变化，不声称正确率提高。证据不足时如实报告，不为通过而换题。

## 安全与交付

只在独立test数据库随机schema、独立Redis/进程/临时home运行；沿用迁移corpus审核和公共库存保护。凭据0600、工具/日志不输出secret；只清理自身资源。UI/真实provider/fixture/本地提交/部署分别记录。无push/merge/release/deploy。本地包skill更新不等于已安装客户端自动更新。
