# Windows 真实同步补验（2026-10-09）

本轮已在 Windows Obsidian 1.13.7 中，使用正式插件、真实生产 HTTPS 后端和合成私有 Space 完成真实同步。0.5.7 复现的预览问题已在正式 0.5.8 中完成原生修复验证：V2 无效目录选择即时禁用确认并提示、V2/V3 手动目录选择后摘要更新、实际拉取与推送、两端最终路径及正文哈希一致。0.5.8 的图片升级后 Sync v3 无差异也已回读。E 场景最终重开同步中心也已确认 Sync v3、文字与图片均无差异。**合成生产资源已撤销，本地证据目录保留；本轮合成场景通过不等于原报告全部关闭。**

这是 [Windows 初轮补验](windows-20261009.md) 的后续记录。初轮“未连接真实后端”的结论仅适用于初轮，不再代表本轮实际覆盖范围。这里没有把单元测试、HTTP 200、远程 Session 可见或代理自述计为原生同步通过。

## 环境与版本

- 既有 Windows Session：`01a0f8b8-b64c-7c80-9114-789d6f72dfc8`。真实同步主回合：`01a11ccb-30d6-76f0-bf8c-82a9918c830a`；正式 0.5.8 加载与第一轮清理回合：`01a11cf5-47ae-72b3-9afa-a6e38b124188`；0.5.8 最终原生验收回合：`01a11d0d-63d0-70a1-b39e-6240076d4b0b`。
- Obsidian 1.13.7；通过官方 `Obsidian.com` CLI 核对临时 Vault 的真实路径，操作其实际设置控件、同步中心和预览按钮；不直接调用插件内部同步实现来代替点击。
- 后端 `https://agentwiki.quukk.com`，网页版本 0.12.17。只为本轮新建合成私有账号、Space、页面和设备凭据；未使用原测试者的 Space 或正文。
- 主同步基线为正式插件 [0.5.7](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.7)，源码 `324fa53b3990fe276ebb1f12b4627a51e8a6b049`。临时安装的 `main.js` SHA256 为 `e53fd66baec0a39ab1e6336382ca00c59d565e519f1eca4706746512b0295821`；运行时 manifest 回读为 0.5.7。
- 修复版本为正式插件 [0.5.8](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.8)，源码 `b9be0afa667e216c87a15f983431109f79b5ca39`。下载与安装后的三资产哈希逐一相同，运行时 manifest 回读为 0.5.8。
- 两个版本均仅安装在临时 Vault。日常 Vault 未安装本轮插件；共享 Obsidian 进程在窗口关闭后的回读中仍存活。

## 0.5.7 实际执行结果

| 场景 | 结果与实际回读 | 证据 |
|---|---|---|
| 连接与多级映射 | 实际设置页点击连接后 `pluginConnected=true`；新增 `验收/Windows` 映射后 `mappingCount=1`，状态为待首次拉取。 | `exec-a6a27ce1`、`exec-888e4e89`、`exec-5e89aff7` |
| 首次 V2 拉取 | 实际预览确认后出现“已按服务器内容更新本地”；映射目录中的 `pages/Keep.md` 为 32 bytes，与同步基线哈希一致。 | `exec-691e9c51`、`exec-8b78030c` |
| 本地文字推送到服务器 | 本地创建 Roundtrip，经真实同步中心预览与确认后，服务器产生对应页面并回读正文。首轮原始字节哈希不同，码点证明差异来自本地末尾 LF+CRLF 与服务器 LF+LF；按协议统一 CRLF/CR 为 LF 后内容一致。此项不声称原始字节完全一致。 | `exec-2ca9dab9`、`exec-f24e396a`、`exec-6eee0426`、`exec-edbd358a` |
| 服务器文字拉取到本地 | 修改合成服务器页面，再经实际预览确认拉取；服务器 UTF-8 与本地文件均为 51 bytes，`exact_utf8_bytes_equal=True`，两端 SHA256 完全相同。 | `exec-82f9af03`、`exec-9d110896`、`exec-d61c2358` |
| 本地删除父目录、服务器新增后代 | 基线空目录 F 在本地删除，服务器保留 F 并新增 F/C/New。实际预览正常打开，没有落入 `UNKNOWN_PARENT`；所走路径为“使用本地内容 → 先合并服务器更新”。 | `exec-53b62794`、`exec-38381916`、`exec-c34945bb` |
| 选择删除仍有后代的目录 | 0.5.7 中选择“保留本地位置”后确认按钮仍可点击，点击才出现 `FOLDER_HAS_DEPENDENTS`。服务器 revision 保持 6，本地 F/C/New 仍不存在，Keep 仍存在。**写入保护通过，但选择后的即时校验缺陷已复现。** | `exec-71ca39f2`、`exec-084e773e`、`exec-c659c9c6` |
| 改选服务器目录 | 在同一实际预览中改选服务器位置并确认，F、F/C、F/C/New 与 Keep 均存在；重新打开同步中心显示 Sync v2、本地与服务器已同步。 | `exec-e1064311`、`exec-1776cc85`、`exec-39103d4f` |
| 手动迁移目录与后代 | 对 M 场景输入 `pages/Recovered`，实际执行和后续推送完成；本地 M 不存在，Recovered/C/New 存在，远端对应路径存在，重开同步中心无差异。**迁移通过，但选择后首个预览摘要仍显示旧 M 路径，摘要缺陷已复现。** | `exec-e6ca199c`、`exec-34391dd6`、`exec-6ead24e0`、`exec-bb154756`、`exec-86364439` |
| 带图片升级 V3 | 合成 68-byte PNG 被正文相对路径引用；实际升级预览显示 1 张、68 B；点击“确认升级并同步”后显示上传批次 1/1，随后弹窗关闭。重新打开同步中心明确显示 Sync v3、无差异、图片上传和下载均为 0。 | `exec-7584e6b0`、`exec-eb666e97`、`exec-566aa664`、`exec-c81c965a`、`exec-26806a55` |

关键内容校验值：

- Keep 基线与目录迁移后的 SHA256 均为 `2388e9f45f7ff9ae05cb7816bcfc043c8d277cacc8be0013e84908fd2e5acba8`，32 bytes。
- 服务器更新后的 Roundtrip 两端 SHA256 均为 `f049c7fa76a1a1a0b2a5966b7ff89884b98f28700c2ab5c2b29737fb9195ff0f`，51 bytes。
- 升级图片 `assets/used.png` 为 68 bytes，SHA256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`。
- F/C/New 与 Recovered/C/New 已做路径、存在性及同步差异回读；未单独完成这两页正文的两端逐字节校验。V3 已验证真实升级链路和最终状态，没有记录成功 Notice，也没有独立下载远端图片再比对字节。

## 0.5.8 修复与正式包原生结果

0.5.8 将 V3 摘要改为根据当前选择重新生成；V2 使用派生预览即时解析页面与目录冲突选择，保留原始预览用于最终确认时的校验。无效选择会在确认前反馈，手动目录路径变更会同步更新摘要。代码、独审及最终 1422 项门禁由独立修复回执记录，不能替代本节的原生结果。

[0.5.8 正式包加载与清理回执](windows-live-sync-058-load-cleanup.json) 中，`exec-159cc54b` 与 `exec-1e206275` 分别记录正式下载包和临时 Vault 安装包哈希，完全相同：

| 文件 | SHA256 |
|---|---|
| main.js | `4c439b451145d6dd684be4582c308626bdf44d74f9b47d2960f791d9d061dd95` |
| manifest.json | `a1409864b67d205a9158357e49f30a136249a67dfa5e8dde6b03290b2aa144c4` |
| styles.css | `5dfe15839220724a57a64ad7ab136761ba2ffaaff3c0235faac1cf1238e762b8` |

`exec-37544bce` 记录实际 reload 后 `runtimePluginPresent=true`、`runtimeManifestVersion=0.5.8`、同步中心命令已注册；`exec-65d6021d` 记录既有 V3 空间仍无差异且无捕获错误。此为正式 0.5.8 的真实加载与已有空间兼容性证据。

初次重载后，旧设置页的添加、删除、断开未产生预期变化，未形成有效的新映射；旧临时目录清理后又有文件缺失，因此该旧 fixture 停止用于验收。新回合在既有临时 Vault 路径中使用正式三资产、新合成账号/Space和新的验收映射；最初建立的 `WinQA-058` 目录未用于实际同步。旧账号状态曾残留，随后通过真实设置按钮断开；不将本轮称为干净全新Vault验收。`exec-2fd66e48` 确认 SettingTab 指向当前 0.5.8 插件实例、DOM connected、所属窗口未关闭；`exec-c455172e` 中点击实际“断开”后按钮立即禁用，随后运行状态变为未连接；`exec-91a95c7f` 中新连接及 `验收/Windows058` 映射通过真实设置控件保存成功。**现有证据不支持 0.5.8 设置页回归。**旧窗口或对象引用导致此前无响应仍是推断，不作为已经证明的根因。

以下结果均来自 [正式 0.5.8 新回合原始输出](windows-live-sync-058-final.json)，对应正式包 SHA 未变。A–E 为本轮场景标识；结论依据实际输出，不使用脚本中的固定 `CASE PASS` 字样作为通过证明。

| 场景 | 实际执行与当前结论 | 证据 |
|---|---|---|
| A：V2 远端正文更新拉回 | 对服务器页面修改内容并通过实际预览确认拉回。本地 SHA 与服务器预期 SHA 相同，`exact_bytes_equal=True`；重新打开 Sync v2 为无差异。首拉及初始本地推送输出未保存在此57条摘录中；本轮双向链路另有C/E的实际拉取与推送证明。 | `exec-2365b131`、`exec-86ecdb30`、`exec-f5d6a034` |
| B：父目录冲突即时校验及恢复 | 本地删除空 F、远端增加 F/C/New，自动合并预览正常打开。选择 local 后确认立即禁用，随后 Notice 明确 `FOLDER_HAS_DEPENDENTS`；改选 remote 后确认可用并实际执行。两端 F/C/New 存在，Keep 哈希保留，重开 Sync v2 无差异。**0.5.7 延后到点击确认才校验的问题已原生验证修复。** | `exec-1d73ace8`、`exec-edd74cd0`、`exec-6e802e71`、`exec-5b15e4cb`、`exec-47b4e12b` |
| C：V2 手动目录摘要、拉取及推送 | 对 M 选择手动并输入 `pages/Recovered` 后，预览摘要即时显示 Recovered、Recovered/C、Recovered/C/New，确认可用。确认拉取后进入实际推送预览，再点击确认完成推送；本地 M 不存在，Recovered/C/New 存在。远端路径相同，两端 New 正文 SHA 相同；同步中心原文显示双方无差异。**0.5.7 摘要仍显示旧路径的问题已原生验证修复。** | `exec-cf2998ca`、`exec-706cb424`、`exec-53302ba0`、`exec-ca15c6c3`、`exec-9368e989`、`exec-42a8d1d3` |
| D：正式 0.5.8 图片升级 | 68-byte PNG 被正文引用；实际预览显示升级 Sync v2→v3、1 张/68 B；确认后弹窗关闭。重新打开明确为 Sync v3、`zeroDiff=true`、`imageZero=true`，UI 原文亦显示无变更。 | `exec-9c9d72a4`、`exec-2f2ce1f5`、`exec-aa67c9f6`、`exec-b4a5b8e9`、`exec-4851c9e2`、`exec-8753fa3c` |
| E：V3 手动目录摘要、拉取及推送 | 本地删除空 F3、远端新增 F3/C/New；选择手动 `pages/RecoveredV3` 并“应用手动路径”后，摘要显示新路径且不再显示旧 F3/New 路径，原冲突说明仍保留，确认可用。实际确认拉取，再确认后续推送，弹窗关闭。远端 RecoveredV3/C/New 路径与本地一致，旧 F3 不存在，两端正文 SHA 相同。最后重新打开同步中心，明确 Sync v3、`zeroDiff=true`、`imageZero=true`，UI 原文显示双方已同步。**摘要修复、实际落地及最终无差异均已验证。** | `exec-d1e303f9`、`exec-b6ca3701`、`exec-da45a718`、`exec-5490afff`、`exec-2037340d`、`exec-a19f5bbc`、`exec-d3b612f2`、`exec-f9f03ab1`、`exec-69f6ae96`、`exec-42a8d1d3`、`exec-139b58c6` |

新回合的精确内容结果：

| 内容 | 远端与本地 SHA256 | 其他回读 |
|---|---|---|
| A 更新后的 Roundtrip | `816d15d9b6a92c11b4b46e670605faaa23852a7ad9b7b9d111ddcb5977b7d3cf` | `exact_bytes_equal=True` |
| E 后最终 Roundtrip（含图片引用） | `fcf249c9baa98572f9ed5144332199a847e4aebf333aeb3706c7c4607f6bb8e1` | 两端均 65 bytes（`exec-e279fa9b`） |
| C 的 Recovered/C/New | `cfaa2a6d6a8aed2ee4af48795db37a9484a14754f0ec52d932f4b89c04ed9a4f` | 远端 UTF-8 正文 29 bytes；最终远端路径 `pages/Recovered/C/New.md` |
| E 的 RecoveredV3/C/New | `6ae0cd41afc95a925b55c4ff50cc0f3db907c19b4bc67c6ab868e11a72dcacc7` | 两端均 29 bytes；最终远端路径 `pages/RecoveredV3/C/New.md` |
| Keep | `10a18c08c57118422dc79b55c4821e965ef60a52c96657e14eeb8a04d61f088c` | B 后与 E 后本地哈希一致，最终远端哈希亦相同 |

最终远端树 revision 为 14，根包含 F、Recovered、RecoveredV3、Keep、Roundtrip，且 `f3Present=false`（`exec-42a8d1d3`）。图片已覆盖实际升级与最终零差异状态；`exec-e279fa9b` 进一步回读远端附件 `assets/used.png` 为 68 bytes、image/png、1×1、active，仍未独立下载远端原 PNG 再比对字节。0.5.7 的历史缺口保留在其自身版本段落，不用 0.5.8 新回合结果倒填旧版本的原始证据。

`exec-9368e989` 的探针布尔值 `zeroDiff:false` 与同条 `snippet` 原文不一致：原文明确显示“本地与服务器已同步，无需操作”“本地没有未推送的变更”“服务器没有新的变更”。这里采用真实 UI 原文，将布尔值记为探针误判，不记为产品失败，也不修改原始 JSON。`exec-634902a6` 的 `Unexpected token ';'` 是探针脚本语法失败；后续 `exec-8753fa3c` 才是 D 的有效状态回读。`exec-91531960` 和 `exec-54d518ac` 的固定 PASS 输出仅保留作过程记录，不单独支持任何验收结论。

## 合成资源撤销与临时目录

第一轮生产合成资源已撤销。`exec-a787fde3` 记录两个测试 Space 删除均返回 200，随后 GET 均为 404；唯一设备凭据删除返回 204；两个 installation 删除分别为 204 与 409（已兑换项）；合成用户删除返回 200，旧用户访问凭据再次访问 `/users/me` 为 401。先前兑换出的设备凭据已单独撤销，不以 installation 的 409 当作删除成功。

`exec-7c457a67` 记录只关闭临时 Vault 窗口，日常 Obsidian 的共享 PID 仍存活。临时文件的递归删除曾被执行器策略拒绝，随后一次 `.NET Directory.Delete` 尝试在 Git pack 文件上因拒绝访问失败；该后续尝试已被根线程叫停，不应重试或换技术绕过。`exec-009f6cd7` 明确回读 `root_exists_after=True`。因此只可声明生产合成资源已撤销，**不可声明本机临时目录已完整清理**。旧目录残留被保留；已撤销的凭据不可继续使用。

正式 0.5.8 新回合亦已清理：真实设置按钮断开后serverInstanceId=null/connected=false（exec-641689a6）；设备凭据撤销204，列表仍保留1条历史项，不称记录物理删除（exec-605b536f）；已兑换installation删除409，不记为删除成功（exec-1cea7d20）；Space删除200后content-tree404（exec-0f4de75d）；账号删除200后旧JWT访问/users/me为401（exec-2ffb9910）。随后只关闭fixture窗口；PID25808存活、fixtureWindowClosed=true、dailyWindowRetained=true（exec-123edaa0）。未再执行任何递归删除，两个临时根目录及脱敏回执保留。Windows最终回执SHA256为7f333844ea11f0ff4692dc8e7c9a6278716641e8a9d56bff88ae071d74fb5af7；exec-92a3dbaf已纠正实际Vault路径为已注册的旧临时根下vault，并单列最初未使用的WinQA-058目录。

## 回执索引与解释规则

- [首回合精选原始输出](windows-live-sync-first-turn.json)：38 条命令结果，来自保存于 `2026-10-08T19:08:16.071Z` 的 100 条快照。包含 V2 全链路及 V3 升级检测，截止点早于 V3 升级确认。
- [V2 最终内容与路径回读](windows-live-sync-v2-final.json)：4 条精确输出，包含正文逐字节匹配、目录恢复与手动路径最终状态。
- [V3 实际升级与最终状态](windows-live-sync-v3-upgrade.json)：4 条精确输出，包含确认按钮、实际提交进度、弹窗关闭及重开后 Sync v3 无差异。
- [0.5.8 正式包加载与第一轮清理](windows-live-sync-058-load-cleanup.json)：8 条精确输出，包含下载/安装哈希、运行版本、已有 V3 无差异、资源撤销及保留目录。
- [0.5.8 最终原生验收](windows-live-sync-058-final.json)：57 条实际输出覆盖新设置实例、A–E 实际控件与同步结果、两端路径/正文哈希、最终Sync v3零差异、图片元数据以及本轮清理和窗口回读。

所有 JSON 只保留相关命令结果，保留 exec ID、退出码与输出边界，未将代理结论补写为工具输出。密码、Token、连接码、无关个人资料与命令输入未复制，日常 Vault 名称已脱敏。源文件 SHA256 用于追溯摘录来源；摘录中的失败和中间状态没有改成通过。

`exec-c659c9c6` 中两个 PowerShell 列表输出格式错误限制了该条回执的远端子树展示；其实际打印的 revision 与本地存在性仍可使用。早期 CLI “Command not found” 即使 exit 0 也不算加载成功，版本判断采用后续真实运行对象。首次 V3 检测时有重复同步中心弹窗，确认前后以唯一弹窗和重开后的状态为证，不能使用旧弹窗的无差异状态代替升级结果。

本轮不关闭原测试者数据中的 UNKNOWN_PARENT、原生中文 IME、真实 provider 会话或原报告其他尚缺原案步骤的边界。
