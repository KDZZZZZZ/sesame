# MT5 报价时钟与模拟交易验收

现有工作区已更新为 **MT5 2.1.8 / portfolio-execution 2.0.4**，应用保持打开；宿主程序未修改或重启。两次更新都先确认全局空闲并备份数据库，旧消息、报告、配置、14个暂停任务及关联对象的内容哈希保持不变。

## 时差原因及修复

当前 FTMO-Demo 的 `symbol_info_tick.time_msc` 表达服务器墙时。三个真实样本比宿主 UTC 超前约三小时，按有证据的当期 GMT+3 解释后年龄为 2711、3719、4732 毫秒。独立 NTP 观测显示宿主约快两秒，不能解释三小时差异。

原生桥接保留原始 tick，另外返回账户/服务器绑定的 `quote_clock`、UTC 时间和规则版本。执行层消费该证明，原生发送前独立复核同一规则版本。5秒源报价时效、1秒最终发送间隔和60秒决策有效期均未放宽；未知服务器、日期和未验证的夏令时区间保持未验证。历史K线/成交时间及其查询合同未被整体平移。

- [三次真实样本及独立核验](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-diagnostic/verified.json)
- [规则来源与年度适用边界](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/official-ftmo-time-evidence-factor-path-audit.md)
- [宿主时钟只读检查](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/host-clock.json)

## 真实模型交易闭环

由 Sesame 主 Agent 使用真实 `openai/gpt-6.1-sol` 及当前模拟账户执行。根助手只测试、审计和修复插件。

| 阶段 | 核实结果 |
| --- | --- |
| 开仓 | EURUSD 买入0.01手，订单567714404，成交543833429，成交价1.12204 |
| 修改保护 | 持仓567714404，SL从1.12010改为1.12020，TP从1.12410改为1.12400；实际持仓读回一致 |
| 平仓 | 仅本轮0.01手，订单567716621，退出成交543835160，成交价1.12211 |
| 退出核验 | 相同position的两笔真实成交对应入场/退出；随后EURUSD持仓查询为空 |

三次写入均返回原生10009，但成交结论另外依据真实成交记录，未把原生回执中的deal=0当成已找到成交。开平仓发送时归一报价年龄分别 **2760 / 2499ms**；本轮无遗留仓位。

- [原生回执、成交与保护价独立断言](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-trade-cycle/verified.json)
- [完整测试调用与Run结果](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-trade-cycle/receipts.json)

## 状态刷新故障及恢复

本轮暴露的`history_deals_get(ticket=orderId)`在当前SDK5.0.6231/终端组合中返回-2。8次有界只读对照确认：字面调用、动态展开和intern关键字都失败；`history_orders_get(ticket)`及`history_deals_get(position)`都成功。这不是已证明的Python展开错误，也没有修改第三方SDK。

执行插件现按原生订单查询真实position_id，再查询该持仓的成交，并只保留确切订单匹配项。不会假定订单ID等于持仓ID；没有可靠身份时保留不确定性，原生失败不变成空成功。目录另补了历史选择器三选一校验。

新版真实Agent已通过通用`manual_trade_status`分别取得唯一入场和退出成交；原生订单回执保持，未重新交易。热更新后的Python worker第一次报-10004，确认后只初始化同一既有连接一次。

- [只读SDK对照](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-native-dispatch/comparison-verified.json)
- [新版安装与状态保持](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/receipt-installation/verified.json)
- [新版通用刷新最终验收](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-receipt-refresh/status-verified.json)

## 回归与本地提交

- 时钟修复：46项Python、60项MT5 JavaScript、60项执行插件、28项隔离宿主检查通过。宿主日志是此前工具回执转存，来源和局限见[记录](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/host-fixture/verification.json)。既有未跟踪测试的本轮差异单独保存，未把历史未提交内容混入提交。
- 历史选择器合同：8项通过，另30个工具定义未变。[证据](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/history-selector/verification.json)
- 状态恢复：45项定向、58项相关回归通过，去重为84项；lint与diff检查通过。[证据](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/order-receipt-fix/verification.json)
- 本地提交：`5e93478`时钟归一与guard、`7187bc6`历史选择器合同、`78c4782`状态恢复及版本。未推送。

## 仍有的缺口

用户指出的《QA20261021-R5 四币固定引用因子研究》由auto-factor插件自行生成整页HTML/内联CSS，再直接发布，尚未接入共享视觉模板。1.1.3修了长内容折叠，没有完成模板统一；历史报告未重写。

准备观测到外层Run完成另有15.058秒间隔。源码确认每个Run收尾会触发全工作区资源扫描，但尚无阶段计时证明它占该次间隔多少，见[延迟审计](E:/brief2great/sesame/outputs/mt5-quote-clock-fix-20261021/live-trade-cycle/latency-audit.md)。MCP交易门禁、挂单修改/撤销、工作流执行器自动交易及其他券商未由本轮验证，不能将本轮写成所有插件全部通过。
