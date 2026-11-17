# 来源与实现边界

Sesame contributors 原创的窄接口、类型树编译器、文件协议、执行适配、因子库与评价代码使用本包 MIT 许可。包不复制或捆绑 Qlib、DEAP、Optuna、MLflow 源码、二进制环境或模型权重；显式 prepare 在私有环境安装上游发行包，依赖保留自身许可。

数值引擎固定为 [Microsoft Qlib 0.9.7](https://github.com/microsoft/qlib/tree/v0.9.7)。通过真实 D.features、标准滚动算子和文件 provider 运行；依据该版本 [ops.py](https://github.com/microsoft/qlib/blob/v0.9.7/qlib/data/ops.py)、[data.py](https://github.com/microsoft/qlib/blob/v0.9.7/qlib/data/data.py) 和 [config.py](https://github.com/microsoft/qlib/blob/v0.9.7/qlib/config.py) 核对行为。用户树先经白名单校验再重建表达式，不传入用户 Python 字符串。

qlib-factor-zoo 仅作为外部参考链接，不复制其代码、公式全集或定制 Qlib 到本包。用户按需登记的定义保存在工作区私有因子库，registrations 记录来源链接、固定版本、许可证和改写说明。复制选定源代码时随用户材料保留相应版权与许可文本；登记并不改变来源的许可归属。

搜索使用真实 DEAP 1.4.4 类型化结构操作和 Optuna 5.0.0 ask/tell，同时提供 seed/template/random 基线。成功安装版本固定在 python/requirements-lock.txt。Windows x64 / CPython 3.12 已验证；环境指纹记录解释器和全部已安装包。Qlib 所需 MLflow 保留，使用明确包私有本地 URI，无需外部实验服务。

纯因子评价没有引入旧策略收益、仓位、Sharpe、回撤、DSR/PBO 或旧 JavaScript 因子计算器。数值测试用显式合成数据，只证明实现行为、边界和可复现性，不证明市场有效性。

历史 v1 的设计参考、原 Sesame factor/strategy 指南、reference 脚本与合成案例在声明中标为 Historical。保留资源维持来源字节，不定义 v3 工具，也不作为当前数值结果。独立 sesame/factor-evaluator 安装项及旧协议已退役，稳定包 ID 不提供旧状态迁移或兼容别名。v3 去掉固定研究总控和自动报告；研究决策由调用方 Agent/工作流负责，底层数学与证据存储继续使用同一协议。
