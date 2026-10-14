# Agent 手工交易工作流

`sesame/manual-trading` 3.0 要求 Sesame **0.2.3-dev.8 或更新版本**，只负责周期/事件调度、逐角色模型、协作、目标仓位、证据复盘与每轮汇总。账户、下单、策略挂载控制由明确选择的执行能力提供；研究和数据工具由所选插件提供。组合使用 `delegatable_tools`、Agent `plugins`、带祖先调用活性校验的调用来源证明 API，以及 `reports.live` 实时面板。安装不创建交易计划。

## 配置

先在选中的执行插件中配置连接和账户，取得其通用绑定，再调用 `manual_trading_models` 选择已配置的供应商/模型。工作流不接受 `backend` 字段，也不默认加载研究来源。

```json
{
  "title": "账户研究与交易",
  "execution": {
    "plugin_id": "用户选定的执行插件ID",
    "context_tool": "该能力的账户上下文工具",
    "apply_tool": "该能力的目标执行工具",
    "arguments": {"binding_id": "该能力返回的绑定ID"}
  },
  "research": {"plugins": ["用户选定的研究插件ID"]},
  "mode": "team",
  "model": {"provider": "已配置供应商ID", "id": "默认模型ID"},
  "agent_models": {"market": {"provider": "供应商A", "id": "模型A"}},
  "symbols": ["准确品种名"],
  "interval_minutes": 60,
  "event_keys": ["important-news"],
  "instructions": "证据不足时保持不变。"
}
```

示例是占位符，使用工具实际返回的名称。内置独立实现 `sesame/portfolio-execution` 的 `portfolio_execution_configure` 可返回上述 execution 对象；这只是一个实现，工作流也接受其他满足相同工具协议的插件。协议见 [COMPOSITION.md](COMPOSITION.md)。

`research.plugins` 可以选择任意已安装、可委派的工具或技能插件；`research.tools` 可缩小工具范围。默认只使用所选插件的可委派工具，不授予 main-only 管理入口，也不自动启用禁用插件。省略 research 保留更新前的选择，`{"plugins":[]}` 清除选择。执行和总结角色不附加研究工具。插件摘要在保存时冻结；变更后需要重新保存计划。

每个 Agent 都可独立选模型：market、fundamentals、news、sentiment、bull、bear、risk、manager、executor、reporter；省略继承默认。team 顺序为四个研究角色并行 → 多空辩论 → 风控 → 经理 → 执行 → 总结。周期至少五分钟，事件使用稳定 ID 去重。同账户的目标执行仍有顺序，研究角色在本轮并行；重启不会补发旧订单。

目标用准确十进制字符串、执行能力声明的单位；`unchanged:true, targets:[]` 有效。未列出的品种保持不变，明确零仓位可以关闭量化策略买入的持仓。继续挂载有极大风险时在 pause_strategies 填观察到的挂载 ID 和具体理由，没有额外权限开关。执行插件负责真实支持范围、账户核验、原生数量规则、最终报价和幂等；工作流保留其真实回执，未知结果不能当作成交。

## 升级

3.0 将原生执行代码及 `manual_trade_*` 工具移入独立 portfolio-execution。旧计划保留历史、暂停并提示重新绑定，不替用户选择后端。新执行实现通过主会话只读 `manual_trading_execution_export` 导入旧回执和未知发送阻塞项；不迁移已过期报价，不删除旧记录。旧运行仍能查看和补归档。

执行确认只接受本轮冻结的 fillSources 与对应 producer 直接登记的原始成交行；派生数据只能作为辅助观察。旧运行没有该来源合同的，不补造交易确认；原有研究与判断记录仍保留，已归档复盘不追溯改写。

## 用户可见资料

账户、全来源持仓、委托与成交历史、挂载、团队结论和研究数据集均可复核。`manual_trading_context` 分页返回，`manual_trading_runs` 查看和取消所属计划；团队公开结论不包含私有推理。研究数据缺口保留在结果中，不从目标推算成交或收益。

### 实时协作界面

主会话调用 `manual_trading_activity(run_id, action:"open")`，直接在 Sesame 报告面板打开本轮实时 HTML，返回临时 viewId。界面使用真实计划阶段和宿主任务状态；上方展示模型、角色和调度流程，下方按时间展示公开发言、报告和读取记录，直接滚动整页阅读。彩色传递动画仅来自后续 Agent 成功读取前序报告；浅灰连线表示计划顺序。单 Agent、多轮辩论和各角色独立模型均使用实际配置。

本体通过已认证的同源 SSE 接收快照，再经限定的 MessagePort 送入报告 HTML；只显示实时工作流和公开交流；发言和完成报告沿整页展开，点击角色可定位其内容。没有暂停画面、时间轴或回放控件。公开内容与工具名称/状态来自宿主公开接口，不展示私有推理、工具参数或原始工具响应。

工作流画布支持拖拽平移、滚轮和双指缩放，以及适应画布、恢复 100% 比例；实时更新保留当前视角。模型图标根据各角色实际模型识别，支持兼容供应商转发的模型。发言和完成结论支持 Markdown 标题、列表、表格、引用、代码及链接；原始 HTML 按文本显示，图片保留文字链接。图标来源见 [MODEL-ICONS.md](MODEL-ICONS.md)。

`action:"read"` 返回同一份结构化快照。每个角色只在运行记录中共享结论，显式使用 `output:none`；一轮业务任务全部结束后，由总结角色统一生成一份 HTML 总报告，保存在 `手工交易日报/<plan>/`，同时保存可核验证据 JSON。打开实时页面不创建文件，也不再另存 `.collaboration.html`。兼容保留的 `action:"archive"` 返回同一份总报告，重复调用不会新增报告。活动日志默认保留最近 2000 条事件并明确返回截断标记，序号不重置；原任务结论仍保留在运行记录中。

动画参考 ChatDev 2.0 的事件驱动方式：真实任务状态控制节点工作动作，成功读取前序资料触发模型徽标沿对应连线移动。首屏和断线重连只恢复当前状态，不重演积压事件；结束、暂停和断线会清理动作，遵守系统减少动态效果设置。

实时视图按插件、所属主会话和运行绑定，不建报告文件或历史版本。HTML 保持隔离且不能直接联网；宿主只转发本轮公开快照。关闭面板会释放连接，停用插件会撤销视图。打开界面不启动 Agent 或发送订单。

每轮完成或失败后，在研究树创建 `手工交易日报/<计划名称-ID>/<时间-运行ID>.html` 和同名 `.json`。旧版共享树使用 `research/` 前缀，新版使用 research space。HTML 展示账户、目标、停止结果、实际回执、团队报告和复盘；JSON 保存完整快照，并冻结为 resource artifact。已有用户文件不覆盖，移动后按稳定文件 ID 定位。

归档 Agent/模型不可用或应用中断时记录 `reportPending`，主 Agent 用 `manual_trading_report(run_id)` 补归档。日报是研究文件，不冒充 `report_publish` 的渲染验证回执。

`judgment-evolution` 的完整判断登记、固定证据核验、归因和规则工具已合入为 `manual_judgment_*`；旧插件及数据保留兼容。交易案例按账户、标的和实际已知时间检索，后续通过 `manual_trading_review` 使用真实外部数据集复盘；不将目标、持有不变或报价变化当作成交收益。[判断与记忆接口](judgment/README.md)说明证据与旧数据迁移。

计划/任务/案例存于插件私有 storage，研究证据存于 datasets，判断数据库/可读导出分别位于 `judgment-state/` 和主工作区 `manual-trading/judgment/`。计划不保存 API 密钥；研究插件仅保存环境变量名。

验证使用虚构账户、来源响应和本地模型协议夹具，不向真实券商发送测试订单。未知发送必须查询原回执；无实盘盈利、零滑点或券商端 exactly-once 保证。
