# visual-mql-v1 实际语言参考

这是编译器实际接受的契约，不是完整 MQL5。源文件使用 MQL5 的类型、函数和结构化语法；平台从校验后的 IR 生成固定原生类、图和观测。没有任意代码逃逸节点。

## 文件和声明

仅编辑六个 `Include/Strategy/*.mqh` 模块、strategy.json、inputs/default.set、README.md。不要添加 include、class、宏、额外源码或手写 rules.json。辅助函数和类型放在所属模块内。

strategy.json 保留 `template_version: "3.0.0"`、`language: "visual-mql-v1"` 和六模块，每模块只有 `mode` 和 `description`。mode 为 unimplemented/custom/native，完成后说明实际方案。无额外风控或保护时，明确实现 AllowNewRisk=true 或保护查询返回 0，并说明原因；不使用 2.x 的 disabled 声明。节点和机器归属自动生成。

`input int Lookback=16;` 在 Signal 中生成 MT5 参数 `Signal_Lookback`，其他模块同理。SET/Tester 参数使用该名称。InpMagic 是平台参数；V_、Product_ 前缀和平台事件名称保留。

## 语法

- 标量 bool/int/long/double/string；隐式转换仅 int→long→double，显式截断用 ToInt(double)。沿用 MQL5 运算顺序、有限精度和整数行为，不提供任意类型转换。
- `enum Phase { Watch, Retest, Consumed };` 枚举项不自定义数值。
- `struct Window { double sum; int count; };` 可嵌套或含定长数组；字段无初值。记录和数组自动清零，记录参数只读。
- 模块级变量是所属模块的跨事件记忆，标量必须有常量初值。`const` 只读；`input` 仅用于模块级标量。局部标量也必须初始化。
- 参数、局部变量和循环计数器不能遮蔽模块记忆、枚举项或函数。单函数局部存储最多 32 KiB，模块记忆最多 1 MiB；复杂记录容量也计入预算。
- `double values[64];` 容量 1–512，动态整数下标有运行时检查。数组不直接作为函数参数/返回值；辅助函数可读所属模块数组，或以记录传递定长数据。
- 支持赋值、`+= -= *= /=`、独立 `++ --`、if/else、switch、for、break/continue、return。条件必须为 bool。禁止函数内 static、指针/引用、动态类和递归。
- 所有分支使用花括号。switch 每个 case 使用 `{ ... break; }`、return 或 continue 明确结束，不允许贯穿。非 void 函数所有路径必须返回。
- for 形式为 `for(int i=0;i<64;i++) { ... }` 或 `<=`。起点/上限为整数常量或 const，最多 512 次；体内不改计数器。用 `if(i>=Lookback) { break; }` 实现参数窗口。可嵌套，静态最坏步数最多 200000，调用深度最多 32。
- 表达式支持一元 `! + -`、算术、比较、`&& ||`、三元选择、字段、下标和静态函数调用。短路及选择只求值选中部分。参数和公式中不能隐藏动作。
- 辅助函数全部解析、检查、展开。查询接口及其调用链禁止修改记忆、发布或交易。事件函数可显式调用有副作用的过程。交易/调度结果可作为独立 return 或 if 条件；状态守卫始终无副作用。

## 必需接入函数

每模块均需 `bool Configure()` 校验参数；空模板返回 false，禁止未完成策略启动。参数名可变，类型/顺序固定。

| 模块 | 其余函数 |
| --- | --- |
| Signal | `void Advance()`、`void ConsumeSignal()`、`int LongCondition()`、`int ShortCondition()`、`double StopLossPoints()`、`double TakeProfitPoints()`、`bool CloseLong()`、`bool CloseShort()` |
| Money | `double Lots(double price,double sl,bool buy)` |
| Position | `void Refresh()`、`void OnTransaction()`、`bool Manage()` |
| Trailing | `double StopLoss(bool buy,double price,double current)`、`double TakeProfit(bool buy,double price,double current)` |
| Risk | `void Refresh()`、`void OnTransaction()`、`bool AllowNewRisk()` |
| Expert | `void Observe()`、`bool Processing()` |

Configure、LongCondition、ShortCondition、StopLossPoints、TakeProfitPoints、CloseLong、CloseShort、Lots、StopLoss、TakeProfit、AllowNewRisk 是无副作用查询。Long/ShortCondition 通常返回 0–100 的强度。止损/止盈点数沿用 Standard Library 调整点，不能误当报价 Point 或价格。

Tick：采集输入 → Risk/Position Refresh → Expert Observe → Signal Advance → Expert 原生分支 → Signal ConsumeSignal。Timer/Trade 仅采集并 Observe；事务采集后调用 Risk/Position OnTransaction。Processing 默认 `return NativeProcessing();`，该平台适配器有分支和提前返回，不是每轮依次执行全部模块。

## 状态和端口

```mql5
enum Phase { Watch, Retest };
Phase phase=Watch;
void Advance() {
  if(Bars()<3) { return; }
  switch(phase) {
    case Watch: {
      if(Close(1)>High(2)) { Transition(phase,Retest,"breakout"); }
      break;
    }
    case Retest: {
      if(Close(1)<Low(2)) { Transition(phase,Watch,"invalidate"); }
      break;
    }
  }
  Publish("ready",phase==Retest);
}
```

这是语法片段，不是默认策略。Transition 的状态必须为本模块枚举记忆或枚举数组元素；目标是同类型枚举项，ID 是静态字符串。必须位于对应 switch 的明确枚举 case 内，不能直接赋值状态或藏进辅助函数。

同一实例同一实际输入事件的后续转移不再改变状态，其他普通语句仍按源码执行。数组机器初态为枚举第一项，下标为实例键，容量固定。bar 去重、超时、重置、订单去重和恢复由策略明确写出。

Publish("port", value) 输出 bool/int/long/double，同一端口类型固定。先用 HasOutput("signal","port") 检查，再用 Read("signal","port") 读取。未发布读取是输入缺失。已发布值跨事件保留，策略自行发布时点/检查过期；不保证读取的是本轮新值。

## 已登记原语

| 调用 | 返回及语义 |
| --- | --- |
| MathAbs/Sqrt/Floor/Ceil/Round/Exp/Log/Sin/Cos(double) | double |
| MathMin/Max/Pow(double,double)、ToInt(double) | double / int |
| Bars() | int，当前品种/周期最多 512 根 bars |
| Open/High/Low/Close/Volume(int index) | double；Volume 是 tick_volume，0 为形成中、1 为最近收盘 bar |
| BarTime(int index)、Time() | long，券商时间秒 |
| Bid/Ask/Point/Equity/Balance/FreeMargin/LotMin/LotMax/LotStep() | double，本事件采集的报价、账户或品种规格 |
| TickSize/TickValueLoss/TickValueProfit() | double，最小价格步长及亏损/盈利 tick 价值；计算每手止损金额前校验大于零 |
| PositionCount() | int，当前品种且匹配 InpMagic，最多 64 笔 |
| PositionVolume/Price/SL/TP(int index) | double |
| PositionTicket(int index)、PositionIsBuy(int index) | long / bool |
| TransactionType()、TransactionOrder/Deal/Position() | int / long |
| TransactionVolume/Price() | double，仅当前事务；不能把全部事务 volume 重复累计为成交量 |
| NativeProcessing/Open/Reverse/Close/Trail() | bool，仅 Expert；Open/Reverse 仍经过策略 Risk 和平台限额 |
| ClosePosition(int index,double volume) | bool，仅 Position/Risk；受管减仓请求，结果不是成交确认 |
| ProtectPosition(int index,double sl,double tp) | bool，仅 Position/Risk；受管保护请求，不允许放宽已有止损 |

输入是本事件已观察事实，不是跨服务原子快照。非 transaction 事件的事务字段清零。无行情、越界、非有限浮点或预算耗尽产生 runtime_error，并锁定本次运行的后续策略动作。先检查 Bars/PositionCount/HasOutput。已发送请求不能回滚，券商已有保护继续有效。

当前没有多品种/多周期采集、挂单改撤、close-by、内部事件总线、持久化恢复、未知外部指标/DLL/文件/网络入口。需要这些能力时报告具体适配器缺口，不能更换成自由 MQL5 绕过。基础计算、状态和记忆可自行组合，不预设策略类型。

## 保存和证据

save 返回可恢复的 file/line/column 诊断；修复后重新 save。成功 revision 的源码、IR、图和生成物绑定摘要。MetaEditor 再编译，生成文件诊断映射回原模块。前端函数图保留分支、循环、提前返回和调用；状态图是投影，编号不是优先级。平台适配器明确作为边界，用户函数可展开。

自动 trace 记录实际事件、控制节点、条件和转移；未执行的短路部分没有记录。原生 trace 有容量上限，截断时只能显示已知部分；不能补造路径或把没记录当作 false。编译成功不是 Tester 验证。
