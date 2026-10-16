独立原生 MQL5/visual-mql-v1 工程使用 mt5_project；SVL→MQL5 使用 svl-mql5 所声明的固定源、翻译与语义验证能力。两者的证据不可互相替代。

mt5_project create 产生未完成草稿，checkout 返回真实可编辑目录，save 冻结内容。工程 README.md/strategy.json 描述当前模块；native-ea 与 visual-state-machines 是声明资源，模板3.x的 skills/visual-state-machines/references/language.md 列出实际受限语言、函数和原语，避免猜测完整MQL5接口。仅任务相关模块需要修改；信号、数量、持仓管理、移动保护、风控和调度由策略明确设计。EA入口、平台SDK和用户限额属于固定边界。图、原生类和埋点由同一源码产生，不维护第二份手写图。

save 的语义诊断定位源文件/行列；修正实际源码可以产生新revision。mt5_compile 针对明确revision运行真实编译器，compile_failed保留build和诊断；需要进一步修改时使用新的源码版本，不能反复提交相同错误。checked只证明受限语言校验，草稿编译成功不等于模块已完成，更不证明策略行为。Tester结果与固定证据由任务目标决定是否需要，报告与委派沿用宿主能力。
