# 外部因子参考

官方插件维护参考链接和适配方法。Agent 按当前任务读取少量候选定义，登记为用户工作区的因子；外部仓库代码和整套公式不随插件分发。

## qlib-factor-zoo

[仓库](https://github.com/JustinF8/qlib-factor-zoo) 是 Qlib 的扩展分支，含多组公式定义。已核查版本为 `ea21f315f2e6e838513cdec20b0c4298d1cf36ca`；按该版本读取可保持来源固定。若使用更新版本，重新核对选中的公式并记录实际 commit。

| 需要的参考 | 固定源码链接 |
|---|---|
| Alpha360、Alpha158 | [loader.py](https://github.com/JustinF8/qlib-factor-zoo/blob/ea21f315f2e6e838513cdec20b0c4298d1cf36ca/qlib/contrib/data/loader.py) |
| Alpha101 | [loader_alpha101.py](https://github.com/JustinF8/qlib-factor-zoo/blob/ea21f315f2e6e838513cdec20b0c4298d1cf36ca/qlib/contrib/data/loader_alpha101.py) |
| GTJA191 | [loader_gtja191.py](https://github.com/JustinF8/qlib-factor-zoo/blob/ea21f315f2e6e838513cdec20b0c4298d1cf36ca/qlib/contrib/data/loader_gtja191.py) |
| TDXGS、JQ110 | [handler.py](https://github.com/JustinF8/qlib-factor-zoo/blob/ea21f315f2e6e838513cdec20b0c4298d1cf36ca/qlib/contrib/data/handler.py) |
| 许可与版权声明 | [MIT LICENSE](https://github.com/JustinF8/qlib-factor-zoo/blob/ea21f315f2e6e838513cdec20b0c4298d1cf36ca/LICENSE) |

## 按需登记

1. 先查用户因子库，根据需要的信号、字段和时间尺度选择参考。用现有搜索/网页/文件能力读取相关源码及其依赖的算子定义。
2. 把选中的数学定义写成当前 `qlib-expr/1` 类型树，核对输入字段、窗口、时序/截面语义和数据可得时间。支持的算子见 [接口](contracts.md)。缺少算子时选可表达的定义，或明确记录语义变化后的新假设；不要以同名伪装等价。
3. 调用 factor_library register，提交 formula、name、hypothesis、sources 和 changes。sources 记录实际源码 HTTPS 链接、commit/revision 和许可证，changes 说明保留或调整了什么。若复制了源代码，随用户材料保留上游要求的版权和许可文本。原创公式 sources=[]。
4. 返回的 factorId 即用户库定义。登记没有数值评价；需要验证时再 prepare/compute/evaluate。同定义的真实评价追加到该 ID，来源保留。公式也可用作 search 的种子。策略通过 factor_pool 明确选用。

## 适配时需核对的语义

- 本插件 Rank 是滚动时序百分位；上游部分 Alpha101 用 `Rank(x,1)` 表达截面意图，二者不同。按真实数学目的选公式，不能机械转写名称。
- JQ 系列的 beta、残差波动和换手率存在代理实现，分别需核对基准收益、回归残差和流通股本；使用代理时在名称/假设及 changes 写明。
- 上游桥接脚本含 pandas 近似和未实现项补零；读取定义后通过现有 Qlib 计算，不使用该桥接结果。自定义算子、行业分类时点及缺失值处理也按选中的公式逐项核对。

这里的链接不增加运行依赖，不替换 Sesame 的固定 Qlib 环境。公式定义、计算证据和策略应用反馈分别保存。
