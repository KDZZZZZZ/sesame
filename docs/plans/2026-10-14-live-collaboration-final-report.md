# 实时协作与单份任务总结

日期：2026-10-14。状态：dev 源码已实现并验证；未替换用户安装目录，未公开发布。

## 用户要求

手动交易、自动因子挖掘运行期间只展示实时协作和公开交流；每次完整任务结束才生成一份总报告。角色不各自产出日报。动画参考 ChatDev 的真实事件驱动方式，保留 Sesame 背景、可拖拽缩放画布、页面下方 Markdown 交流区，不提供播放、暂停动画或回放时间轴。

## 事实与归因

1. 自动因子挖掘已对所有角色指定 `output:{type:'none'}`，手动交易依赖插件任务相同的默认值。因此没有证据表明当前每个角色实际发布了一份日报；角色公开结论仍需保留为协作资料。
2. 已发布手动交易查看器在 `run.finished` 后自动另存 `.collaboration.html` 与 JSON，加上任务日报形成两个 HTML 出口。移除独立协作归档；仅保留实时查看器和已有任务汇总。
3. 自动因子挖掘的 `report.js` 仅渲染静态快照，含事件播放定时器，未接宿主运行状态；读取账本也没有有向交接事件。补齐运行状态/公开输出观察、成功读取事件和 SSE 查看器。
4. 因子运行暂停、失败后也可导出报告，恢复会按内容摘要生成新文件。中途状态应保留在账本和实时页；完整运行结束后的报告应幂等，不能因查看或重试产生额外 HTML。
5. 本地 `dev` 的手动交易仍为 2.1.0，带未跟踪预览 assets；新查看器位于已发布提交 `fae1d900c320065b13bbf6817770a0ca5863b171`。另一个工作树正在修改 MT5、记忆和编排插件。仅将已提交的手动交易查看器及其测试同步回 dev；先备份两插件当前内容，不改其他工作树的未提交修复。
6. 归档故障回归确认：手动交易 JSON 成功、HTML 失败后，新增归档事件可能挤出有界日志，重算的证据不再一致，导致重试永久 `REPORT_PATH_OCCUPIED`。首次归档前冻结业务快照，逐文件持久化 ID/摘要，补写使用同一快照并尊重用户移动、编辑与删除。
7. 用户补充要求在 Sesame 报告面板看实时 HTML。原独立 localhost 页面不符合该入口；现有报告 iframe 的 `connect-src 'none'` 会拒绝直接 EventSource。增加宿主临时 HTML 视图与同源 SSE，再用限定 MessagePort 转发快照；保留 iframe 网络隔离，不创建角色报告或临时文件。插件移除独立 HTTP 服务。

既有另案问题：手动交易计划的 list/read/configure/setEnabled/trigger/cancel 入口未统一核验 owner，而活动查看器已核验。本次没有改计划控制语义；需单独厘清主会话是否全局管理计划后再统一修复，不能直接将“可管理”收窄为每会话隔离。

## 实施边界

- 角色任务显式 `output:{type:'none'}`，工具/提示词限制为共享结论、结构化产物与真实执行；整轮最后统一归档。
- 复用现有原生 HTML、SVG、模型图标与 Markdown。增加宿主临时报告面板 API，插件独立打包，不增加运行依赖，不暴露 Pi 对象、私有推理、工具原始参数或响应。
- ChatDev 主线使用运行事件更新节点状态、真实边事件驱动角色沿 SVG 路径移动；核实固定提交后记录来源。消息传递动画必须由真实成功读取资料触发，不能用定时器编造协作。
- 因子观察不得把留出集提前送入研究上下文；不得改变数值评估器、研究预算或交易策略。
- 不执行真实付费模型、交易或回测；验证使用受控模型响应和合成数据。浏览器验证优先使用宿主 Electron 内置 Chromium。

## 验证标准

1. 全部角色不创建报告文件树条目；一轮结束只有一个汇总 HTML，重试/重复打开/读取页面不增加文件。
2. 未结束与暂停状态不能发布最终总结；报告失败可幂等补归档，用户移动/删除/编辑仍受保护。
3. 因子 SSE 随真实任务、工具、公开输出和共享读取更新；来源作用域、断线重连、停用清理正确。
4. 动画使用任务开始/结束与成功交接事件；首屏和重连不重复播放历史；缩放和平移保持，低动态偏好生效。
5. 两插件针对性回归、真实宿主 fixture、Electron UI 检查、包锁/manifest 校验通过。记录验证缺口，不将模拟模型测试宣称为真实供应商或市场效果。

## 取舍

后台仍由插件服务调度并观察宿主任务。报告面板的临时 HTML 只订阅本轮公开状态，不承担调度或交易；最终报告保留可复核证据。手动交易与因子挖掘独立安装，复用展示资产以一致性检查维护。宿主新增 `reports.live` 负责临时视图的生命周期与 SSE 转发，无外部服务。

## ChatDev 参考来源

核实主线提交 `4fb2db0ea90375ce1059f44fe03ffbd191a7a169`：[真实运行事件与节点状态](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L2236-L2317)、[沿 SVG 路径移动](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L1971-L2092)、[忙碌动作与停止清理](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/components/WorkflowNode.vue#L47-L88)。项目采用 [Apache-2.0](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/LICENSE)；本次仅参考真实事件驱动动画的思路，不复制 ChatDev 代码、人物素材或品牌资产。最终报告保留只读事件记录，不移植旧版日志回放。

## 最终实现

- manual-trading 2.4.0、auto-factor-mining 1.0.0-dev.2；角色显式 `output:none`，整轮终结后仅归档一个 HTML，JSON 是证据附件。手动交易目录继续使用研究区“手工交易日报”。
- 删除插件独立 localhost HTTP 服务。`manual_trading_activity` / `auto_factor_activity` open 返回 `viewId` 并直接打开 Sesame 报告面板；没有报告文件、版本或每角色日报占位。
- 宿主 `reports.live` 按插件、会话和 key 注册临时 HTML；公开状态由宿主已认证 SSE 经 nonce MessagePort 转入隔离 iframe。保持 `connect-src 'none'`；不开放 HTML 工具调用、Node 或 Pi 对象。关闭标签释放订阅，停用插件撤销视图；容量不足只回收无订阅的空闲视图。
- 每个真实任务状态控制工作动作，成功读取共享结论触发带模型图标的移动；首屏/重连先基线后连接状态，跳过历史动画；摄像机位置、页面下方 Markdown、系统低动态偏好均保留。
- 总报告按文件 ID 预览，用户移动后继续打开；删除或编辑不会被插件补写覆盖。补齐并发归档、半成功归档、打开与关闭竞争的回归。
- 旧宿主的其他能力不受影响，`reports.live` 缺失时打开活动明确返回 `HOST_UPGRADE_REQUIRED`。内嵌面板需要此次 0.2.3-dev.7 宿主源码一同部署。

## 验证证据

- 插件针对性便携回归：173 项，172 通过，1 项真实宿主观察测试按环境跳过；该观察测试另在设置 `SESAME_HOST_ROOT` 后通过。因子包内 51 项全部通过。
- 实际安装入口与 Pi 集成：3/3。手动交易含 manager/executor/reporter，因子含各角色模型、两路研究、Store 重开恢复和单份最终报告。模型传输使用本地夹具；供应商付费调用、真实券商调用均为 0。
- Electron 画布/Markdown/共用资产/跨宿主 SSE 面板：20/20；最后样式调整后再验 2/2。真实销毁 SSE socket 后重连不重播；生产 HostContext → SSE → MessagePort → 插件 HTML → 一份最终文件完整链路通过。没有寻找或安装本机独立浏览器。
- 宿主注册/API 6/6、完整报告面板 Electron 1/1、既有 SSE/文件库回归 4/4；前端构建与 TypeScript、定向 oxlint、OpenAPI（101 operations / 147 schemas / 39 examples / 25 rejections）通过。
- 两插件共用 assets/live-viewer 一致性通过。独立干净副本执行官方包检查，锁文件仅更新这两个条目；其他插件、Kurumi 临时数据与已有 Python cache 保留。整个工作目录的包检查会遇到这些既有临时文件，本次没有将它们纳入包。
- 宿主共享 Electron 网络策略由其他工作修改，本次保持原策略。审查中发现的既有 WebRTC 隔离边界另见宿主 live-reports 接口文档，不将保留 CSP 误述成全网络流量防火墙。

具体记录：`output/live-collaboration-package-validation.json`；Electron 截图 `output/live-collaboration-panel.png`。首次修改前备份位于 `E:/brief2great/sesame/research/backups/live-collaboration-20261014`。宿主改动仅在 `E:/brief2great/sesame/mt5agent` 工作目录，未覆盖其余并行修改。
