---
name: market-discovery
description: 根据任务发现数据来源、缓存和精确品种，选择一般查询、固定历史或图表显示入口，并核对实际结果。
---

# 发现与获取数据

## 1. 复用已有证据，定位缺口

已有适用的 DataRef、SourceRef 和 InstrumentRef 可直接复用，不重复发现。明确缺少的是来源、品种、时间范围、周期还是字段，再查询相应目录或插件能力。

data_sources 查全部声明来源；data_providers 只保留市场与账户来源，不能用于寻找所有数据集或原生缓存。列表缺项时继续查适配器的公开能力和资源。例如 MT5 有 mt5_cache 与 bars 数据源，具体操作和账户范围按其声明选择；不能因没有通用 cache 工具就放弃本机缓存。

## 2. 确认身份与可用性

行情缺少精确品种时使用 market_instruments search，需核对周期、价格、复权、时段或时间口径时再 describe。使用返回的 ref，展示 symbol 不能替代 InstrumentRef；连接修订与来源修订分别保留。

available 不是连接健康或会话加载状态。为 false 时通过 plugin_inspect 查实际禁用、运行失败及依赖诊断；按原因处理，而不是一律 plugin_load。配置交给来源插件与统一配置入口，SourceRef.binding 只接受来源 configSchema 明示的配置。

## 3. 按任务选择入口

| 任务 | 入口与交付 |
| --- | --- |
| 查看一般来源的一页数据 | data_query；需要后续页时沿用 nextCursor。 |
| 固定一般来源的完整查询结果 | data_snapshot；自动分页，返回固定 DataRef 与证据。 |
| 取得研究用历史 K 线 | market_read；固定精确品种、spec 和区间。 |
| 显示行情或指标 | 画布插件的 canvas_binding → canvas_apply；已有匹配绑定直接复用。 |

一般来源、查询、缓存、分页和失败恢复见 [来源查询](references/source-queries.md)。行情的完整参数、时间与成交量语义见 [历史与显示](references/market-history.md)。不要把来源 operations 的宿主内部能力当成 Agent 工具直接调用。

## 4. 核对实际结果并交接

历史结果用 ref、evidence、实际行数和来源元数据核对，交给方法、工作流或 analyze-data。保留 Decimal、SourceTime 与真实来源标记；预算超限、快照漂移或中途失败不发布截断结果。同一操作重试保持输入与 ID，新观察用新 ID。

显示结果检查 canvas_inspect 当前版本的目标图表状态、bar_count 与 feed_status。历史读取成功不证明实时流或浏览器显示正常；warning 不等于 error。订阅错误以底层来源诊断为准，不把指标缺少输入另判为新的来源故障。协议错误不能靠重复重绑或新建探针图消除。
