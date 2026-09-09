# 接入体验根本改造

## 目标
Obsidian 默认浏览器授权自动连接；Agent 可恢复分步接入，连接与知识导入分开，实际客户端读取验证。

## 状态
候选代码、必要自动验证及独立审查已完成；Obsidian真实成功路径通过，用户已回传OpenCode实际读取正确标题与验证标记，Agent宿主读取门禁通过。网关静默降级诊断缺口已修复并独立复审关闭。主分支 codex/connection-ux-20260909，代码 16db7cfd，应用0.11.0/LocalSync0.10.0/protocol0.6.0。独立插件5751424，候选0.5.0，插件协议依赖仍0.5.1。尚未公开发布、合入master或生产部署。

## 实现与复审
Task1/2/4均完成，原作者修复后交叉复审C0/I0/M0。全新独立主分支审查的过期确认问题亦修复关闭。插件原I1-I4及终态恢复回归全部关闭，C0/I0/M1（17条基线lint warning）。所有失败历史保留。

## 自动验收
client1447/server2602+专用DB3/LocalSync907通过，LocalSync1原有跳过；全lint/typecheck/build、registry protocol干净安装、版本契约33通过。最后CLI修复独立43项+中央23项/build/lint通过。runtime263通过/1平台跳过，DB206通过+1环境失败，独立空库重跑失败文件4/4通过。插件前一提交full1350，最终5751424相关65项/typecheck/lint/build/bundle通过，控制器独立65项+bundle/metadata通过。

## 真实验收与下一步
专用预览5198/API53098，PG55448/Redis56398；不操作旧环境、原Vault或用户知识。真实Codex消费复制提示词完成授权/配置/网关，wiki_get_page被隔离宿主审批策略拒绝。新Vault已安装最终5751424，实际映射ConnectionAcceptance、预览确认拉取、打开测试页读标记、停用/启用恢复均通过。用户首轮OpenCode手测只发现六个local工具，诊断为公开0.9.1加生产旧连接返回401。候选连接SDK stdio读页通过；用户随后回传真实OpenCode工具agentwiki_wiki_get_page返回标题「连接验证说明」及标记CONNECTION-UX-20260909-READ-OK，宿主读取验收通过。CLI已补明确脱敏网关诊断，最终复审C0/I0/M0；完整LocalSync923通过/1跳过/1旧源码锁测试超时，该文件原样单跑29通过。下一阶段为独立的公开发布与生产部署门禁。

## 恢复入口
读refs、SDD progress及最终review报告。私有release-candidates包含最终LocalSync tgz与插件三件套/hash，报告在agentwiki/docs/verification/connection-ux-candidate-20260909.md。不要重复派已完成实现，不删除旧handoff或失败证据。
