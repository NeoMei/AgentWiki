# 当前目标

用户已授权发布本轮8项复测修复。GitHub Web/API0.12.47与插件0.5.12已正式发布；npm0.13.1等待本人安全密钥认证，生产部署尚未执行。

# 范围 / 不做

保护原检出用户修改、原正文/事务/身份/hash；不修改日常Vault。原Windows与原黄金书屋wrapper错误仍待验/未复现。没有依赖或数据库迁移变化。

# 当前状态

- Web/API正式源码a192d775，origin/master及tag v0.12.47已推送，GitHub非draft正式release已回读。独立审查无P1/P2。
- 插件0.5.12正式源码fd06387，main/tag CI与Release CI通过，三个官方资产逐字节/来源证明通过；完整1551项。回执plugin-release.json/md。
- Local Sync0.13.1固定tgz已通过两种空目录安装、公开protocol0.6.1一致性与专用schema检查。npm尚未发布，安全密钥认证超时，需要本人完成新的挑战；不得绕过2FA或新增身份。
- 最新full exit0：server3318/4skip、client2659、protocol140、local1018/1skip、runtime309/1skip、串行DB239/0skip。build/typecheck/lint及元数据独立复审通过。首次full失败由测试继承GIT_WORK_TREE造成，清除后通过。
- 生产仍0.12.46；1351源码文件匹配既有发行，3服务active。配套备份/var/backups/agentwiki/retest-feedback-v01247.cb1ekxak已校验，writers恢复，未演练恢复。新源码manifest1354文件已准备。
- 原页8项发布进度已追加published/autoPublished，ChangeSet cmvbwqnjz00bjrinsnvx39hrd，精确MCP回读/Chrome渲染通过。没有将GitHub发布标记为生产上线。

# 稳定约束

Git命令显式--work-tree指向带尾空格的工作树；不要把GIT_WORK_TREE导出给测试，临时git init会失败。唯一现有MCP连接/身份保持；旧0.13.0接入会话继续原固定版本命令，不改版本/hash。私有生产截图/原页材料不提交。

# 关键索引

- .codex-memory/tasks/active/retest-20261017/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-20261017/{release.json,plugin-release.json,status.md,acceptance.md,validation.json}
- .superpowers/sdd/retest-20261017-plan/release-pack/ 固定发行包及完整清单
- .superpowers/sdd/retest-20261017-plan/release-sdk/verify-installed-gateway.mjs 已独立复审的正式包验收脚本
- /tmp/agentwiki-release-20261017/ 备份、manifest、full retry与生产验证脚本

# 风险 / 下一步

本人完成npm发布安全密钥后，发布并回读0.13.1官方包；再显式host113.249.120.24/root使用已有SSH control部署，验源码/公网assets/健康/烟测/真实浏览器日期排序导航与窄屏；正式gateway复用现有连接做顶层参数更新本页并确认published/精确回读。追加最终逐项上线回执后再归档此任务。原Windows仍单列待验。
