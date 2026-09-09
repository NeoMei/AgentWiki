# 全面复审修复计划

## 全局约束
仅修已复现bug；不改后台领域规则、权限、CAS、协议或schema。基线9b69bc65。复用隔离worktree。真实UI和DB使用专用本地环境。先失败用例后修复；独立复审每项和整分支；终轮全量测试。

## Task 1: 编辑保存迟到响应
修复PageEditor已成功PATCH后旧loadPage GET晚返回导致正文/版本回退。覆盖保存前、保存中触发的GET和409/403既有处理。保持用户在保存中的新输入。

## Task 2: 搜索索引并发与向量有效性
用数据库原子同步保障词法索引反映当前Page；旧indexPage不可覆盖新索引。正文hash改变时使旧vector失效，生成失败后可重试；向量远程调用必须在DB锁外，最终保持CAS。无schema改动。添加真实DB并发与失败重试测试；保留现有effects contract。

## Task 3: 收尾验证
核对原Task1–7与后续release/技术债任务；多轮审查；全量前后端协议本地同步/DB；真实UI创建目录文章、保存预览、历史、搜索、子页、390px和清理。刷新任务/验收记录，整合已授权修复；根据实际变化决定发布补丁。

## Task 4: 目录写事务实时授权复核
复核ContentTreeController已有鉴权与事务之间权限变更窗口。若真实DB确认，则沿用AuthorizationService锁顺序 User -> Space advisory -> 实时Space访问检查，在web目录create/rename/delete/restore/move事务中复核。保留目录精确owner/editor规则；目录设计明确禁止admin写，通用授权函数自动扩展admin后仍须检查实时返回角色；仅实时User super_admin可豁免。不要为内部已授权事务添加重复/反向锁，也不允许仅外部检查。先做本地合成用户降权并发回归，不涉及生产用户。

Task1补充：同文件passive cleanup在ref解绑后读取handle导致离开编辑器再POP无法恢复光标；修复并用真实卸载/POP回归。

## Task 5: 依赖安全补修
发布门禁发现Hono/Multer运行依赖通告，扩展全依赖审查又发现js-yaml与Vitest工具链通告。按官方修复版本最小升级、保留全部测试覆盖及构建策略，分别复验运行依赖和全依赖audit；测试工具主版本升级需验证全部现有配置和套件。独立复审后重新验收。应用0.10.2，同步包版本保持。
