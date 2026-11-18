# Sesame 策略开发

sesame/strategy-development 是 API 2 可选插件。一次研究以投资委托和可检验假设开始，产出可编辑的策略结构、固定源码、原生参数试验和带证据的修订。每个写入步骤返回 projectRef，后续调用传入精确引用，父版本仍可读取。mandateRef 可独立引用。首次组装和固定事件验证无需安装因子研究或原生回测后端。

| 入口 | 用途 | 可核对的产物 |
| --- | --- | --- |
| strategy_development_plan | 从目标和上下文填写委托，建立模板，补输入或单槽替换 | 委托版本、字段来源、研究假设、硬约束、组件和可执行的缺失反馈 |
| strategy_development_method | 按实际研究判断选择九种设计、检验和改进技法 | 带竞争解释、实验、适用条件和反例的短方法 |
| strategy_development_study | 在编写完整策略前，用开发行情检验收盘突破到可入场时还剩多少延续 | 完整和截尾机会数、跳空与开盘后的方向变化、同方向全部决策的参照、逐次机会示例 |
| strategy_development_build | 在当前工作区发布现有 SVL 或生成可编辑模板，按需运行事件和组合用例，导入独立的 Python 策略 | 固定源码及可选重放记录、原生程序摘要 |
| strategy_development_verify | 在已保存的单路收盘行情重放中检查首次可用时点和不同预热长度 | 同一时刻的节点、状态、订单意图差异及未覆盖的情形 |
| strategy_development_backtest | 在原生 Backtrader 上分批跑参数组合、按委托约束过滤、单目标排序和独立确认 | 原生 Run、各批次结果、冻结参数、失败或淘汰数量、留出成交和权益证据 |
| strategy_development_compare | 比较原策略、候选、可选的匹配对照与消融 | 开发期指标与交易差异、可比性和缺失的证据 |
| strategy_development_read | 重新打开项目并诊断如何修订 | 原始设计、版本关系、检验范围、失败原因与下次实验 |

## 从现有对话起步

下面是一项研究情景。Agent 从已有上下文填写有依据的条件，将自行选择的模拟设置标为 assumption。只有相互冲突的明确委托条款才触发定点澄清。

~~~json
{
  "operation_id": "trend-plan-1",
  "goal": "研究 XAUUSD 趋势策略是否可以减少震荡期的无效交易，最大回撤 10%。",
  "research_design": {
    "mechanism": "事前已知的市场状态会影响突破延续性。",
    "rival": "过滤器只减少了暴露时间和手续费。",
    "prediction": "在同方向、时段和事前波动相近的突破中，放行组从最早可成交价起有更强延续。",
    "distinguishing_test": "比较加过滤版本与交易次数、敞口相近的基线抽样组，再核对错过的盈利交易。",
    "falsifier": "匹配后改善消失，或延续主要发生在可成交之前。"
  },
  "mandate": {
    "context": [
      { "source": "assumption", "evidence": "研究账户的模拟费用情景，后续用目标账户资料复核", "fields": {
        "capital": { "amount": "100000", "currency": "USD" }, "costs": { "commission": "0.001", "slippage": "0.0005" }
      } }
    ]
  },
  "design": { "strategyId": "gold.trend", "mode": "framework", "components": { "alpha": { "model": "long_breakout", "settings": { "lookback": 20 } } } }
}
~~~

对这个假设，先用 study 传入上一步的 project_ref、固定 development 行情和 study 参数。例如 `{ "method": "breakout_continuation", "lookback": 20, "horizon": 5, "side": "long" }`。收盘严格突破前 20 根最高价才计入。分别衡量跳空和从下一根开盘到随后第 5 根收盘的方向变化，并与全体可用决策对照。假定某次突破收盘为 100，次日开盘 110、收盘 105。收盘到收盘上涨 5%，允许从次日开盘进入的人面对的当日价格变化是 −4.55%。插件保留这项设计证据，已观察的日期在同一项目中登记为开发数据。原生回测可继续回答实际成交与成本后的问题。

用返回的 projectRef 调用 build。省略 source_path 时会在工作区生成可编辑的信号或状态模板。使用自编源码时保持相同 strategyId。传入 replay_path 检查指定事件，workflow_path 可运行持仓、风控和订单方法用例。native_source_path 接受已编写的 Backtrader Python 文件。插件会冻结文件内容，后续回测可以在独立工作区重建同一版本。

## 参数搜索和留出

backtest 接收 operation_id、project_ref 和 experiment。一个开发实验使用 backend 为 backtrader、已冻结 Python 文件内的 class_name、实际固定的 development 数据引用、config.feed、parameter_space 和 max_trials。例如 fast 的 20 个值和 slow 的 30 个值构成 600 组。预算须覆盖声明的完整网格，参数之间不合法的组合应在设计时处理。运行无可调参数的基线时，传入空的 parameter_space 和 max_trials 为 1，后端按固定或默认参数执行一次原生回测。已在委托中约定的资金、费用、滑点和目标自动带入。收益和回撤按比例计，0.10 表示 10%。缺少资本或成本口径时，先在委托或实验配置中明确。

数据使用已冻结的 json-rows OHLCV 引用和带时区时间戳。优化器分批执行 Cerebro.optstrategy，保存原生回执和每组实际结果。完整且满足约束的开发候选才有 selectionRef。只做开发实验可省略 holdout。确认时传同一项目的 selection_ref、backend 和未参与选择且时间更晚的 holdout。冻结代码、交易成本和参数随选择记录恢复。对照只取开发结果。已使用的留出保存在项目版本链中。

以下为同一项目的两次 backtest 调用参数。built、sweep 分别是构建和开发实验返回的结果，developmentData 与 confirmationData 是调用方已经冻结的数据引用。参数名必须与 Python 策略类相符。

~~~js
const search = {
  operation_id: 'trend-grid-1', project_ref: built.projectRef,
  experiment: {
    backend: 'backtrader', class_name: 'Trend', development: developmentData,
    config: { feed: { timeframe: 'days', compression: 1 } },
    parameter_space: { fast: [5, 10, 15], slow: [20, 30, 40] }, max_trials: 9
  }
}
const confirmation = {
  operation_id: 'trend-confirm-1', project_ref: sweep.projectRef,
  experiment: { backend: 'backtrader', selection_ref: sweep.experiment.selectionRef, holdout: confirmationData }
}
~~~

每次搜索最多声明 8,192 个组合，实际每批大小随行情行数和后端预算调整。默认报告约束内的开发集最优值及相邻参数实测分数。需要选择稳定区域时，在搜索前传入 selection 为 { "method": "neighborhood_worst" }，可用 max_step 限定各轴距离、categorical_axes 指明整数枚举。结果给出单点最优、满足双侧覆盖的候选及实际冻结者。没有合格邻域时保留缺口。同一项目的不同修订共享已使用区间记录，从旧版本分支时同样检查串用和时间重叠。

Backtrader 后端使用本机 Python 进程运行已提供的策略。插件声明 process.execute 供这条调用链使用，检查环境时不会安装依赖。结果衡量独立编写的 Python 实现。SVL 与目标引擎的数值、事件和订单语义需要另行对照。MT5 项目应依次取得 target、translation、compile、conformance 和原生 Tester 的证据。当前批量寻优入口会给出这些已有能力及缺失步骤。研究记录包含未验证的委托硬约束，模拟盘验证另行进行。

## 因子和策略在哪里检验

| 问题 | 责任位置 | 证据 |
| --- | --- | --- |
| 这个因子是否有预测或风险信息 | 现有因子研究插件，按需使用 | 精确定义、开发分区、目标期限、覆盖率、IC 等原有评价和评价 ID |
| 策略在作决策时能否得到相同的值 | 本插件的因子使用契约和目标实现检验 | 输入、变换、缺失、观测和首次可用时点、实现及一致性证据 |
| 加入它是否改善这条策略 | 本插件的完整策略实验 | 同一开发集、费用与预算下的基线、加因子、匹配对照和消融，含净收益、回撤和交易差异 |

## 从交易证据检验一个具体改法

例如“允许小幅持仓偏差能否降低换手，又能否改善净表现”。在单一日线现金股票的开发项目，用 native_template 为 forecast_buffer 调用 build 可取得可编辑的 Backtrader 源码。先以显式 buffer_fraction 为 0 和空的参数网格运行固定基线 A。该例子的交易单位、硬风控和公式见[趋势仓位与缓冲模板](references/forecast-buffer.md)。

~~~js
const decision = await plan({ operation_id: 'register-buffer-test', project_ref: a.projectRef,
  parameter_trial: { component: 'execution', parameter: 'buffer_fraction', to: 0.10,
    hypothesis: '允许小额偏差会减少双边成交额', primary: 'turnover', direction: 'minimize' } })
const b = await backtest({ operation_id: 'test-buffer', project_ref: decision.projectRef,
  experiment: { backend: 'backtrader', planned_trial: true } })
const result = await compare({ baseline: a.projectRef, candidate: b.projectRef })
~~~

这里的 plan、backtest、compare 分别代表上表对应的公共入口。开发数据、固定源码、原基线已选参数、资金和费率沿用同一组。interventionOutcome 给出所预测指标的方向和委托目标的实际变化。用 read 的 diagnostics.tradePath 查看成交额、佣金、初始资本口径的换手、逐笔 MAE/MFE 的可观测下界及覆盖。trade_page 可翻页读取细节。

方法按当前问题读取。调用 strategy_development_method({}) 发现全部方法，传 method 取得正文。例如 hypothesis-design 用竞争解释设计测试，strategy-revision 从实测证据选一个改法。[研究假设](references/hypothesis-design.md) · [组件设计](references/design-and-build.md) · [因子用法](references/factor-integration.md) · [增量对照](references/incremental-evaluation.md) · [稳健性](references/robustness-analysis.md) · [从诊断到修订](references/strategy-revision.md)
