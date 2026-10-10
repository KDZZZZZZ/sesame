# 可展开的量化函数库

调用 `strategy_functions({output_path:"strategies/quant-extension.json"})` 取得 `sesame/quant@1.0.0`。把文件中的完整对象放进 SVL 1.2 源的 `extensions` 数组，然后以 `function.call` 调用 `sesame/quant/rsi` 等名字。模块版本与全部函数字节的摘要固定在源中；更新函数库需要新的策略修订。不要只写函数名或跳过模块内容与摘要。

这些是插件内的普通 SVL 函数，可以在逻辑图中展开，并在 replay 中看到内部计算，不是宿主新加的指标黑箱。没有外部 Python/JS 调用、隐含网络或模型请求。

| 函数 | 参数 | 计算约定 |
| --- | --- | --- |
| rsi | prices, period | Wilder 平滑。第一根价格作上下文，前 period 个涨跌差的均值作种子；其后新值=(旧值×(period−1)+当前值)/period。全平为 50、只有上涨为 100、只有下跌为 0。至少 period+1 根价格 |
| atr | bars, period | bars 每项为 high/low/close 的十进制字符串。第一根仅提供前收盘价；从第二根开始计算 max(high−low, abs(high−前收), abs(low−前收))，以前 period 个 TR 均值初始化 Wilder 平滑。至少 period+1 根 |
| macd | prices, fast, slow, signal | 宿主明确的 SMA 种子 EMA；快 EMA−慢 EMA，再对差值算 signal EMA；返回 macd/signal/histogram。histogram 是差值，不乘二 |
| bollinger | prices, period, deviations | 最近 period 根均值与总体标准差（ddof=0）；返回 middle/upper/lower，deviations 非负 |
| donchian | highs, lows, period | 最近 period 根高点最大值与低点最小值，包含当前输入末根；突破策略需自行 shift 排除当前根 |
| zscore | values, period | (末值−窗口均值)/总体标准差；常数窗口返回 not_ready |
| volatility | prices, period, periodsPerYear | 一步对数收益率、样本标准差（ddof=1）、乘 sqrt(periodsPerYear)；年化频率必须显式提供 |

prices/highs/lows/values 是按时间顺序的 decimal series，最多 512 项；period 等长度是正整数，volatility 的 period 至少 2。价格和波动率的单位由调用者在输入边界固定，不能混合不同币种/品种。MACD 需要保留来源时间的行情序列，不能将无对齐证据的两个数组默认为同一时序。

缺历史、缺值不会当作零。RSI/ATR 的内部缺值使结果未就绪，不跨空洞继续平滑。函数结果可以包含未就绪字段；先以 value.isReady 检查再改状态或生成意图。所有函数仍受整次事件计算预算约束，大窗口或重复展开超过预算会暂停而不提交交易意图。

```json
{"id":"rsi14","op":"function.call","inputs":{"functionId":"sesame/quant/rsi","arguments":{"record":{"prices":{"input":"bars","field":"close"},"period":14}}}}
```

ATR 的 bars 参数只含 high/low/close，可通过 array.map 从固定 OHLC 输入构造。不要把混有 volume/time/其他字段的记录直接当成这个精确 record 类型。

数值回归使用手算窗口、上下行/横盘、缺数及初始化样例；它验证公式口径，不证明任何策略有收益。目标后端须映射所有展开函数，并单独检验原生数值差异。
