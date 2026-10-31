# 离线历史首屏、报告导出及依赖插件更新：一次性空闲部署

最终打印修复同时包含滚动证据完整展开和 print 媒体测量，避免静默裁切与空白尾页。共享导出/HTTP 19/19、真实 Electron 16/16；量化快照 PDF 14→13 页，保留页文本与末页渲染一致，PNG 三片不变。超高报告仍明确拒绝，所有资源预算不变。Playwright 开发适配器源码已同步，但安装版不包含且不执行该模块，部署白名单无需新增它。最终摘要以本文件表格、restart.ps1、evidence.mjs 三处一致值为准。

主负责人已于 11:36 UTC 正常关闭桌面并完成备份。首次 Node 预加载路径错误在执行维护之前被拦截，随后修成 file URL。11:42 UTC 接续中的三次正式管理已成功：reports 过渡回滚 → data-access 3.0.1 → reports 3.0.3。末尾严格子库指纹检查停止了后续复制/启动：Runtime.init 对五个早已 interrupted 的 Agent job 再次记了一条相同状态事件。原子库全部实体及旧事件全文未变；对应主 job 仅 version 增加 1、updated_at 更新，其他字段不变。第六个空子库完全未变。两次 failure 和全部原日志保留，不重跑管理或重新采集基线。

**当前先核验已经完成的插件维护，再接续文件部署；不重跑 `restart.ps1` 或 `resume-stopped.ps1`。** 以下两步交主负责人依次审阅执行，准备者未执行：

```powershell
node E:\brief2great\sesame\outputs\live-plugin-qa-history-fix-20261020\verify-completed-maintenance.mjs
pwsh -NoProfile -File E:\brief2great\sesame\outputs\live-plugin-qa-history-fix-20261020\finalise-stopped.ps1
```

第一步只读打开数据库，不构造 Store/Runtime、不调用管理或模型；仅向本目录写新证据。它绑定三次正式操作和失败回执的固定 SHA-256，逐库核验停机备份与原实体、原事件前缀，只允许独立定位的五条事件（seq 107894–107898，固定时间和完整正文摘要）。五个主 job 只允许已核对的 version/updated_at 改动，其余字段及对应 interrupted Run 全文不变，并保存接受后的 job 全文摘要。保留主保护实体、9 条暂停、6 条历史暂停、输入、策略版本增加 2、最新源码/安装包摘要、旧修订和依赖锁、模型/业务尝试均为 0 的全部检查。通过后写 `child-event-additions.json` 和带 recovery 说明的 `plugin-maintenance.json`，不会覆盖原 `stopped.json` 或失败回执。

第二步要求已验证的两份新证据和全部原回执摘要一致，复用原 attempt 文件白名单及 before/after 摘要，重新执行 maintained；它会逐项重新核对精确的子库追加和五个主 job 全文摘要。之后只做原应用文件备份与白名单复制（index 最后）、maintained-final、原普通桌面启动和 verify。它没有 Runtime、插件管理、capture/stopped 或关闭程序的执行路径。新日志和 attempt/failure 均为 `finalise-stopped-*`；所有原 failure/log 均保留。启动后仍不打开 child SQLite，采用原正常启动语义检查。最终成功仍以 `verified.json` 为准，任何失败不自动重试。

主负责人确认任务完成后，可执行只读空闲检查：

```powershell
node E:\brief2great\sesame\outputs\live-plugin-qa-history-fix-20261020\evidence.mjs check
```

一次性维护入口会再次核对空闲，先备份，再正常关闭：

```powershell
pwsh -NoProfile -File E:\brief2great\sesame\outputs\live-plugin-qa-history-fix-20261020\restart.ps1
```

本次白名单及固定 SHA-256：

| 操作 | 相对应用目录路径 | SHA-256 |
| --- | --- | --- |
| 第一步复制 | modules/frontend/electron/report-renderer.js | 4870c617b216169cfa47358deca80fdd340d815a63682708e463275f92ab6bc9 |
| 第二步复制 | modules/agent/report-export-renderer.js | 06d7ae1a31958c4330224d5efb17567caa33ad5e3978f09d69e9e30057b17d75 |
| 第三步复制 | modules/frontend/dist/_app/index-tCR0dXSA.js | 072df325e87d50f847551d9c0039503c0a8b541d00eacadd4adc073252159afe |
| 最后复制 | modules/frontend/dist/index.html | 93efcf73e7c9203d473f477e3ca10ca25c13b75a9163559759b04841d5110765 |
| 仅校验，禁止复制 | modules/frontend/dist/_app/index-DvEfgOOa.css | a5c97ea6395faba0c3b527baa8819590fd2e3d6f696767852741dbf7da59e76c |

源码变动、CSS 与安装版不一致、入口页缺失或所有文件已部署时拒绝继续。新 JS 可以原本不存在，记录 before: null、backup: null；已有目标文件先备份并验证摘要。所有旧 asset 保留，重启后核对旧页面引用的 JS/CSS 原摘要。打印适配器和共享导出修复均由主负责人审阅：Windows 按私有占用保持 384 MiB 预算，缺字段回退驻留占用，并保留 PDF/PNG 的原资源错误。真实 Electron 15 项、共享导出与 HTTP 18 项通过；v3 中文快照并发导出 9 页 PDF 的内容核验见 ../live-plugin-qa-export-electron-20261020/handoff.json。

沿用现有路径：

| 用途 | 路径 |
| --- | --- |
| 程序 | E:/brief2great/sesame/mt5agent/release/win32-x64-agent-messages-20261020/win-unpacked/Sesame.exe |
| 配置 | %LOCAL_USER_PROFILE% |
| 工作区 | %LOCAL_USER_PROFILE% |
| 数据库和暂停输入备份 | %LOCAL_USER_PROFILE% |
| 原应用文件备份 | 本目录 previous-application-files 下对应路径 |

执行与保留检查：

1. 只读打开主 app.sqlite，确认数据库已是 WAL。检查全部会话活动、待处理消息、queued/streaming 回复、queued/running/interrupting/cancelling Run 和 Agent 任务、未投递通知、未开始 delivery、未完成 ingress，以及能唤醒 Agent 的待投递 Run message；存在任一活动就停止。首次检查失败只留唯一命名的日志，不产生正式回执、不备份、不关闭。
2. 通过当前桌面同源只读 GET 核对 55 个启用插件均 ready、模型已认证、主会话空闲、输入框无草稿。动态捕获插件版本和摘要、模型/认证、配置摘要、主消息、报告及其他保护实体、全部暂停任务与冻结输入/版本锁；确认 6 条历史暂停与崩溃前记录一致。完成主库 SQLite 备份，再次核对空闲和保留项。
3. 正常 CloseMainWindow，等待全部 Sesame 进程退出，不强杀。只有确认全部退出后才读取和备份子 SQLite，核验实体/事件摘要，并备份暂停任务的非数据库输入和 JSONL。
4. 隐藏启动 plugin-maintenance.mjs。它核对当前 9 条暂停（含 6 条历史暂停）、备份和基线，在新的 plugin-staging 目录复制两包最新源码，版本按维护前实际版本与源码版本中的较高值递增 patch。它仅通过正式 managePlugin 顺序执行：reports rollback 到既有 bundled_origin 无锁修订 → data-access update → reports update。最后一步重新测试并锁定新版 data-access；原包缓存、已装包内容和 DB 锁字段均不手改。
5. 维护 Runtime 禁止 accept/session/pump、Agent 服务、通知/控制消息投递、ingress、Run start/resume、所有模型推理，以及任务清理和遗忘副本后台动作。只启动 data-access、reports、workspace、plugin-manager、memory 的管理所需服务；行情及业务定时服务不启动。任何被拦截的推理或业务尝试也视为维护失败。全程模型调用必须为 0。
6. 两包最后版本、源文件摘要、安装摘要及依赖锁验证成功后，关闭维护 Runtime/Store。逐项验证全部 loadout、报告、主消息、暂停输入、冻结版本、通知及其他配置；仅允许这两个 plugin_installation 的精确新摘要，以及正式两次 update 必然产生的 settings/plugins.version 增加 2 和保持有效状态相同的显式 states 写入。记录独立 verified 插件维护回执，再只读检查停机子库和输入摘要。
7. 完成白名单原文件备份，按顺序复制两个打印相关宿主文件、新 JS，最后复制入口页。CSS 始终只校验。启动前再次核验插件维护回执、最终源码/安装摘要及停机数据；任何失败都保持桌面停止，不自动回滚或启动。
8. 启动原普通可见桌面，使用同一配置、workspace 和 pi 目录。Node helper 隐藏启动。最多等待 120 秒定位调试端点和普通页面，再最多等待 15 秒定位输入框；不会因慢启动重复开程序。
9. 启动后只读主 WAL、非数据库文件和桌面 GET，验证 55 ready；只有两包版本/摘要采用已验证的最终维护结果，其他插件完整等于捕获基线。核对同一模型与认证、9 条暂停及其中 6 条历史暂停、输入、冻结版本、主消息、报告和其他配置。页面必须加载新 JS 和原 CSS，旧 asset 摘要不变，白名单目标及备份摘要正确。启动后不打开子 SQLite。

通知通常要求摘要不变。仅允许目标已 completed/cancelled/unknown 的 Agent 控制消息发生 Runtime 原有的终态确认：固定结果、投递时间和一次版本递增，正文、来源、目标及 Run 摘要不变。这类记录不会调用 accept 或启动模型；其他可唤醒记录阻止维护。Agent 已经正常取消的任务不计入暂停集，不会被恢复。

回执顺序为 attempt.json、before.json、stopped.json、plugin-maintenance-attempt.json、三个 plugin-maintenance-step-N.json、plugin-maintenance.json、deployment.json、launch.json、verified.json。插件最终回执以 before/stopped 文件摘要绑定本次备份；它不会替换或重写原基线。只有 plugin-maintenance.json 的 status: verified 才允许启动，只有最终 verified.json 的 status: verified 才确认整次部署完成。既有回执、staging、备份及日志不覆盖；失败写 plugin-maintenance-failure.json 或 failure.json 并停止，不自动重试、回滚、强杀或再次启动。

evidence.mjs 不导入 Store/Runtime，只读校验；plugin-maintenance.mjs 只在全停机、备份通过后导入受保护的维护 Runtime，经正式插件管理 API 写入安装状态。脚本不直接写业务 DB、不发送研究消息、不恢复任务或切换模型。凭据只记录摘要，不保留内容。沿用已验证的 SQLite 行普通对象化、Get-Command node 仅选一个 Application 和 120 秒启动等待。

空闲复核和正常关闭之间没有宿主原子维护锁，仍存在外部任务进入的短竞态窗口，执行期间勿另行派发任务。子库验证只在停机阶段进行，最终回执记录 childDatabasesOpenedAfterLaunch: 0。
