# 来源、查询与固定快照

## 来源目录与身份

| 接口 | 用途 |
| --- | --- |
| data_sources({contract?,providerId?,cursor?,limit?}) | 全部静态来源，包括行情、账户、登记数据、执行记录及适配器原生数据；limit 默认 50、范围 1–200。 |
| data_providers({contract?,providerId?,cursor?,limit?}) | 同一形状，仅保留 sesame.market/1、sesame.account/1；筛选后空页仍可能带 nextCursor。 |

返回 `{items,nextCursor?}`；每项包含 `{ref:{providerId,revision},contract,operations,configSchema,available}`，可有 description。providerId 是 pluginId#sourceId，revision 是精确声明修订。可选 binding 只填 configSchema 明示配置或连接引用，不是任意密钥容器。

available 表示来源所属插件未禁用且未处于运行失败状态，不表示外部连接成功，也不等同本会话已加载。可发现插件仍可能 available:true；false 时读取实际插件诊断，分别处理禁用、启动失败或依赖问题。

operations 是操作键到宿主能力的映射。data_query.operation 填该键，省略时为 query；consumers 仅含 host 的能力经数据入口分发，不能直接 invoke，也不能改点号或下划线猜工具名。临时 bindingId、绑定与释放由宿主管理。

## 查询与分页

data_query({source,operation?,input,limit?,cursor?}) 返回实际 `{items,nextCursor?,metadata?,...}`，metadata 保留来源声明的领域元数据。limit 默认 100、范围 1–1000。续页保持 source、operation、input、limit 不变并使用 nextCursor；游标有效期为 60 秒，不是长期证据。过期重开查询，不能拼接不同查询或不同来源修订的页冒充一份快照。

### 查询一页：data_query

下面查询真实存在的宿主登记数据来源；调用前替换占位 datasetId。插件私有数据集应使用其自己的来源与输入声明。

```json
{
  "source": {"providerId": "host#datasets", "revision": "host:2"},
  "operation": "query",
  "input": {"datasetId": "<宿主登记数据ID>"},
  "limit": 100
}
```

## 固定完整结果

data_snapshot 必需 source、input、operationId、title，可选 operation、maxRows、provenanceKind、dependencies。自动读取每页并发布 `{ref,evidence,rowCount,columns,sample,provenance,receipt}`；ref 为完整 DataRef，evidence 保留真实采集与来源证据。默认最多 100000 行，另有 1000 页和 16 MiB 采集预算；超限或中途失败不发布截断结果。

来源未记录 provenance 时明确 provenanceKind（observed、derived、user_input 或 demo），已有来源标记不可改写，demo 不能升级。dependencies 使用实际已发布的完整固定引用。来源实际覆盖与宿主分页完成是两个事实，不以分页结束推断所有历史都存在。

### 固定数据：data_snapshot

此例沿用宿主登记输入已有的 provenance；调用前替换真实数据 ID 与本次操作身份。

```json
{
  "source": {"providerId": "host#datasets", "revision": "host:2"},
  "input": {"datasetId": "<宿主登记数据ID>"},
  "operationId": "dataset-snapshot-001",
  "title": "研究固定输入",
  "maxRows": 10000
}
```

同一 operationId 只重试相同输入。成功快照不重新查询；完整读取后发布失败也复用冻结字节。新观察或修改范围、预算时使用新 ID。

## 缓存与失败定位

缓存属于具体适配器能力，不是独立的通用数据来源类别。例如已安装 MT5 可发现 mt5_cache 与 sesame/mt5#bars：前者按其声明查询或同步，后者经 data_sources 取得 SourceRef 后 data_query。缓存范围、账户与同步条件以适配器回执为准；缓存已有数据可否使用与实时终端连接分别判断。

STALE_REVISION 重新发现来源，CONNECTION_CHANGED 重新核对连接修订。SCHEMA_MISMATCH 等协议错误保留原始代码、消息和来源身份，修复具体来源；重复绑定同一身份不能消除错误。没有找到某一来源、一次权限失败或工具缺项，不足以断言所有本地缓存不可用。
