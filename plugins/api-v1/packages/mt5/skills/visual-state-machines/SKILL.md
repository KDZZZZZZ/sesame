---
name: visual-state-machines
description: 编写受限 MQL5 策略模块，自动生成原生 EA、协作图与决策状态机；根据带源码位置的解析、类型、效果及 MetaEditor 诊断修复工程。
---

先读取 checkout 的 README.md、strategy.json 和实际源码。新工程是模板 3.0.0 / visual-mql-v1；开始编辑前必须通过 plugin_read 读取 `skills/visual-state-machines/references/language.md`。那里列出实际语法、接入函数、原语和限制，不能按完整 MQL5 的自由度添加调用。主 Agent 与 subagent 使用相同规则。

## 一份源码

- Agent 只编辑六个模块文件、strategy.json 的实现方式/说明、SET 和 README。平台维护 EA 生命周期、原生类壳、交易对象、SDK、图和自动埋点。新工程无默认可执行策略。
- 使用有类型参数、有限枚举、记录、定长数组、纯计算函数、显式记忆、顺序、分支和常量有界循环组合算法。所有函数体都解析；禁止宏、任意 include、class、指针、递归、未知接口或黑盒节点。
- 查询与动作分开。每份记忆仅由所属模块写入；Publish/Read/HasOutput 提供有类型的跨模块端口。未发布、无行情、越界和非法计算不能当作正常零值；先检查可用性。
- 用枚举记忆及明确 switch case 中的 Transition 表达状态。守卫无副作用；同一实例对同一实际输入事件最多转移一次。业务没有记忆时不编造机器。bar 去重、失效、超时和请求确认由策略明确实现。
- 原生调度有提前返回；默认 NativeProcessing 作为版本化平台边界显示。自定义 Expert 调度必须在受限函数中组合登记的 Native 原语。Risk 禁止新增风险时仍保留退出/保护分支。
- 发送结果与成交事实分开。只用真实 request/order/deal/position 标识关联；部分成交、待撤、未知结果需要显式状态，不凭盈利或时间相近补造路径。平台限额不能由策略放宽。

## 修复闭环

1. 修改当前 checkout，调用 mt5_project save。解析、类型、效果、预算错误会作为 `visual_mql_invalid` 工具结果返回文件/行/列；当前轮继续。修改对应源码再 save，不重复提交相同错误，也不改生成物规避检查。
2. save 成功取得新 revision 后调用 mt5_compile。该工具重新校验冻结源码、IR 和生成物，再执行 MetaEditor。compile_failed 是可恢复错误；生成文件的诊断尽量映射回原模块位置，完整日志保留在 build。
3. 需要理解某节点时，用 mt5_inspect 的 project_id 或 build_id 加 engine_node_id，读取实际输入、调用关系及源码；不要手写第二份图。
4. 编译成功且模块声明完成后才能进入原生 Tester；`checked` 表示受限源码通过语言校验，不是策略盈利、原生适配器行为或完整交易恢复的证明。已有冻结构建不能靠修改 HEAD 获得新权限。
5. 相同诊断反复出现时检查语言参考、对应源码及接口，不无限盲重试。用户取消则停止；环境缺失说明缺失依赖。报告默认由 subagent 生成，主 Agent 保留工具权限。

模板 2.x 工程按 native-ea 的旧协议维护代码和声明，不自动迁移历史研究；前端仍标明手工声明。图中文字随用户语言，平台控件使用 i18n，节点 ID 不参与翻译。
