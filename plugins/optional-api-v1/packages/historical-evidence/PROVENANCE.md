# Provenance

本包 JavaScript 是 Sesame contributors 原创实现，按 MIT 发布；未复制或打包 scikit-learn、R isotone 或论文附件代码，不声称已审查这些独立代码包的再分发许可证。标准数学公式、公开文献和官方说明用于核对定义及限制；它们不是本包具有预测有效性的证明。

2026-10-29 核对的一手来源：

- de Leeuw, Hornik, Mair (2009), [Isotone Optimization in R: PAVA and Active Set Methods](https://www.jstatsoft.org/article/view/v032i05), DOI 10.18637/jss.v032.i05。用于核对单调最小二乘与相邻违反合并。
- scikit-learn 官方 [IsotonicRegression](https://scikit-learn.org/stable/modules/generated/sklearn.isotonic.IsotonicRegression.html)、[probability calibration](https://scikit-learn.org/stable/modules/calibration.html)、[TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)。用于核对校准与独立拟合、Brier/可靠性解释和时间切分。
- NIST/SEMATECH [Confidence intervals for proportions](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)。用于核对 Wilson score 公式和二项比例解释。

所有示例为合成软件验收数据；固定引用中的占位 digest 不能当作真实市场证据。真实宿主回归会发布实际固定输入、核对 metadata/revision/digest/dependencies 后调用。测试不使用日常数据库、密钥、网络或真实模型。相似情景、经验频率、校准输出和成功执行均不等于因果证明、策略回测或交易授权。

1.1.1 的匹配回放适配沿用本包原匹配数学与校准回放的双时钟原则：仅新增明确历史查询的真实生成/观察和虚拟前缀/成熟检查，保持固定 Ref 完整性；移除 distance 对未使用 tolerance 的必填要求。通用日期解析、PAVA、窗口、条件频率和样本选择方法未改变。原始观察入口不能借回放字段绕过时序要求。

1.1.2 增加原创固定结果发布适配，使用宿主标准 resources create/read/publish、持久幂等日志和原子发布/CAS；不复制宿主实现，不改变算法标识 `method_version:1.1.1` 或计算结果。完整 JSON 结果及输入依赖原样保存，模型只接收固定引用和摘要。演示血缘继续为 demo；其余结果为 derived，不能借发布升级为原始观察。真实隔离 Host 回归核对大结果预览、完整字节摘要、全部统计等值、依赖读取、重复/并发/确认丢失与重启恢复；纯内联能力仍不访问宿主或发布资源。
