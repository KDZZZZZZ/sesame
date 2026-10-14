# Agent 手工交易

`sesame/manual-trading` 要求 Sesame 0.2.2+。支持周期、事件和按需启动的交易 Agent，单 Agent 或 team 均输出目标仓位。原有 `manual_trade_*` 单次交易工具继续可用；安装本身不会创建计划或发送订单。

## 配置和触发

主会话加载本插件、已配置的交易后端与独立 `sesame/financial-research`。MT5 通道要求带 `execution_guard` 的 Python SDK（1.3.0+）；QMT 单次交易要求 1.2.0+，后台计划要求带签名授权的 1.3.0+ 工具。`manual_trade_inspect` 给出单次交易能力，保存计划时核验后台通道。先调用 `manual_trading_models`，再调用 `manual_trading_plan(action:"save", plan:{...})`：

```json
{
  "title": "账户研究与交易",
  "backend": "mt5",
  "mode": "team",
  "model": {"provider": "已配置供应商ID", "id": "默认模型ID"},
  "agent_models": {
    "market": {"provider": "供应商A", "id": "模型A"},
    "risk": {"provider": "供应商B", "id": "模型B"},
    "manager": {"provider": "供应商C", "id": "模型C"}
  },
  "symbols": ["券商准确品种名"],
  "interval_minutes": 60,
  "event_keys": ["important-news"],
  "account_events": true,
  "debate_rounds": 1,
  "slippage_bps": 50,
  "instructions": "按用户确定的投资目标和风险范围管理账户；证据不足时保持不变。"
}
```

示例名称是占位符，必须使用工具返回的真实供应商/模型。每个 Agent 都能独立选模型：`market`、`fundamentals`、`news`、`sentiment`、`bull`、`bear`、`risk`、`manager`、`executor`、`reporter`。省略的角色继承默认模型。计划固定配置摘要，模型配置变化后需重新保存，不静默切换。

可选 `research_plugins:["sesame/abu-indicators","sesame/abu-exit-rules"]`，从已安装且可用的 ABU 研究基线中选择本计划需要的方法，最多 18 个。未配置时不加载任何 ABU 插件；更新计划省略此字段保留原选择，传空数组清除。保存时校验安装状态，运行时由宿主固定所用包的摘要；缺包或停用不静默换算法。只有研究/决策角色收到所选分析工具和 `plugin_read`，执行及日报角色不增加研究工具。

每个 ABU 工具保存固定输入与结果数据集，返回 `dataset_id`、有效参数、输入与代码摘要。**这些代码是可改进基线，不是标准答案。** Agent 可在主会话研究工作区保留原版并另写改进版本，记录假设、差异、全部试验与固定样本外对照；后台交易计划使用已选择的版本，代码实验不会自动替换挂载策略。研究结果作为决策证据，不直接作为已成交仓位。

周期最低 5 分钟，应用必须运行。重启后错过的周期只产生一轮当前决策，不补发历史订单。也可以省略周期，使用 `manual_trading_run(plan_id,request_id)` 或 `manual_trading_event(key,event_id,data,observed_at?)`。重投事件保持 ID/内容一致；快速事件合并为该计划最新待运行事件。同账户的不同计划串行执行。

MT5 的 `account_events` 订阅持仓和委托变化，断流后重新绑定。QMT 当前不提供账户订阅，明确显示不可用，仍支持周期和命名事件。用 `manual_trading_plan` 的 pause/resume 暂停或恢复计划；停止计划不撤销已发送的券商指令。

## team、仓位与挂载控制

team 参考 TradingAgents 的显式报告传递：四个分析师并行研究 → 有限轮次多空辩论 → 风控 → 组合经理 → 执行 → 日报。每个角色是宿主真实 Agent 任务，保存模型、状态、报告和数据集引用；后续角色读取已完成报告，不读取私有思维链。单 Agent 模式由 manager 完成研究与决策，再使用相同执行/归档步骤。

最终调用 `manual_trading_decide` 冻结目标：

```json
{
  "unchanged": false,
  "rationale": "证据、风险、异议和失效条件",
  "targets": [{"symbol": "券商品种", "quantity": "0", "unit": "lots"}],
  "pause_strategies": [{"deployment_id": "已观察挂载ID", "reason": "继续运行会造成的具体极大风险"}],
  "evidence_dataset_ids": ["已登记研究证据ID"]
}
```

MT5 为有符号 lots，QMT 为非负整数 shares。允许 `unchanged:true, targets:[]`；未列出的品种保持不变，零仓位关闭该品种全部实际持仓（包括对冲两侧），不限制来源。量化策略买入的持仓也能减仓或平仓。QMT 遵循实际可卖数量/T+1。

**没有独立的策略暂停权限开关。** 提示词要求继续挂载有极大风险时停止策略。MT5 核验计划账户、版本和挂载归属后调用真实 `remove_expert`；回执表示停止 EA，不表示已平仓或支持恢复旧运行状态。QMT 没有挂载停止能力，不虚构结果。

目标有效期 5 分钟；执行逐笔读取新账户/报价，用稳定操作 ID 复用原交易服务和原生最终核验。原子订单观察最多 60 秒、报价最多 5 秒、最终报价到发送最多 1 秒。外部策略改变剩余目标差额、未确认停止 EA、工作挂单、部分成交、未知回执或待确认限价单均停止当前批次并要求核对。报价容差不保证市场成交价。

后台写操作由运行时签名绑定到本轮具体指令，模型不能通过直接调用底层工具改写已冻结目标。交易操作和券商回执归主会话保存，可用 `manual_trade_status` 查询、核对未知结果；同账户配置版本变化后仍可恢复查询。

## 用户可见资料、日报与复盘

Agent 与用户读取同一份账户、全来源持仓、委托、成交历史、挂载策略、研究数据集和团队报告。`financial_research_query/read` 提供价格、财务、新闻、SEC 披露、分析师、内幕交易、FRED 宏观和 Reddit 情绪资料；缺源、缺密钥和历史版本缺口明确保留。

`manual_trading_runs` 支持列表、完整读取和取消；`manual_trading_context` 对账户明细、历史和团队报告分页。完整记录持久保存，案例检索另保留有界摘录及原运行 ID，不将截断数据说成完整账户。

### 实时协作界面

主会话调用 `manual_trading_activity(run_id, action:"open")`，返回本轮协作界面的本地 URL。界面使用真实计划阶段和宿主任务状态；上方展示模型、角色和调度流程，下方按时间展示公开发言、报告和读取记录，直接滚动整页阅读。彩色传递动画仅来自后续 Agent 成功读取前序报告；浅灰连线表示计划顺序。单 Agent、多轮辩论和各角色独立模型均使用实际配置。

界面通过同源 SSE 持续更新，只显示实时工作流和公开交流；发言和完成报告沿整页展开，点击角色可定位其内容。没有暂停画面、时间轴或回放控件。公开内容与工具名称/状态来自宿主公开接口，不展示私有推理、工具参数或原始工具响应。

工作流画布支持拖拽平移、滚轮和双指缩放，以及适应画布、恢复 100% 比例；实时更新保留当前视角。模型图标根据各角色实际模型识别，支持兼容供应商转发的模型。发言和完成报告支持 Markdown 标题、列表、表格、引用、代码及链接；原始 HTML 按文本显示，图片保留文字链接，离线记录也可阅读。图标来源见 [MODEL-ICONS.md](MODEL-ICONS.md)。

`action:"read"` 返回同一份结构化快照；`action:"archive"` 在所有任务结束后保存同目录的 `.collaboration.html` 和 `.collaboration.json`，可离线阅读已结束的工作流和交流记录。已打开的运行结束时会自动保存协作记录。活动日志默认保留最近 2000 条事件并明确返回截断标记，序号不重置；原任务报告仍保留在运行记录中。

查看器按需监听 `127.0.0.1` 的随机端口，每轮 URL 带随机访问令牌，仅主会话可创建；拒绝外部 Origin/Host 和写请求，停用插件后关闭。URL 在插件运行期间有效；若宿主消息不能打开 HTTP 本地链接，复制到浏览器即可。打开界面不启动 Agent 或发送订单。该 URL 可读取本轮公开交易报告，应与本地研究文件一样保管。

每轮完成或失败后，在研究树创建 `手工交易日报/<计划名称-ID>/<时间-运行ID>.html` 和同名 `.json`。旧版共享树使用 `research/` 前缀，新版使用 research space。HTML 展示账户、目标、停止结果、实际回执、团队报告和复盘；JSON 保存完整快照，并冻结为 resource artifact。已有用户文件不覆盖，移动后按稳定文件 ID 定位。

归档 Agent/模型不可用或应用中断时记录 `reportPending`，主 Agent 用 `manual_trading_report(run_id)` 补归档。日报是研究文件，不冒充 `report_publish` 的渲染验证回执。

`judgment-evolution` 的完整判断登记、固定证据核验、归因和规则工具已合入为 `manual_judgment_*`；旧插件及数据保留兼容。交易案例按账户、标的和实际已知时间检索，后续通过 `manual_trading_review` 使用真实外部数据集复盘；不将目标、持有不变或报价变化当作成交收益。[判断与记忆接口](judgment/README.md)说明证据与旧数据迁移。

计划/任务/案例存于插件私有 storage，研究证据存于 datasets，判断数据库/可读导出分别位于 `judgment-state/` 和主工作区 `manual-trading/judgment/`。计划不保存 API 密钥；研究插件仅保存环境变量名。

验证使用虚构账户、来源响应和本地模型协议夹具，不向真实券商发送测试订单。未知发送必须查询原回执；无实盘盈利、零滑点或券商端 exactly-once 保证。

另提供 `scripts/manual-trading-live-preview.mjs` 做本机集成验证：独立临时宿主 profile 安装生产插件，读取已经运行并连接的 MT5，仅本地模型接口返回 mock 回复；事件触发、原生 Agent、工具读取、报告传递、目标保存和日报归档全部实际执行。该入口关闭测试 profile 的交易及宿主操作，模型仅提交 `unchanged:true`。它不登录或启动终端；缺少真实连接即停止，不补造账户。运行结束会核验零下单/零挂载操作，默认保留进程供浏览器查看，`--once` 验证后清理 profile。真实账户数据只在临时 profile 中，勿提交到版本库。

```sh
node plugins/optional-api-v1/scripts/manual-trading-live-preview.mjs --host-root /path/to/mt5agent --terminal /path/to/terminal64.exe --python /path/to/python
```
