# 执行、输入与结果

本包脚本是 Python 3 标准库（建议 3.10+），不用 pip，不调用网络/账户/终端。先通过 workspace 检查已有 `python3 --version`（Windows 用已配置 Python）；缺失时按宿主现有依赖流程处理，不因加载 skill 自动安装。

## 固定实际输入

1. 使用 data-access 公开发现、`market_read`（通常 include_forming=false）取得 `ref/raw/dataset_id`，保留 `provenance.query.instrument/spec`、`coverage`、`provenance.observedAt`。原始 volume_kind/unit/status 不能改变。
2. 调用 `data_read({dataset_id: actual_id})`，保存返回实际路径，例如 `inputs/actual_id.json`；不要把 sample 当完整输入，也不要手填原始 prices 来冒充这次读取。
3. 用 `write` 写 `source.json`，字段为：`ref`（完整 DataRef），`instrument`（sourceId/instrumentId），`spec`（timeframe/priceBasis/adjustment/session/calendarRevision），`provenance_kind`（从实际数据保留），`coverage`（原值），`snapshot_observed_at`（已知 UTC unixMs 或 null）。不写 configuration/credentials/token。示例 source.json 的 ref=null 只适用于 demo；真实研究必须使用实际固定引用。
4. 用 `plugin_read` 读取本包 `scripts/bar_input.py` 和 `scripts/observe.py`，再用 `write` 原样保存到工作区同一目录。不要让 Agent 重写算法或读取本体私有代码。脚本只校验 supplied ref 的结构，真实内容绑定由 `data_read`/执行快照/`research_register` 保障；它自己没有独立向宿主校验 ArtifactRef。
5. 在当前真实工作区执行（替换 actual_id，或使用 data_read 返回的路径）：

```sh
python3 -B observe.py --input inputs/actual_id.json --source source.json --output output/observations.json
```

保存 `bash` 返回的 execution_id、exit_code 和 snapshot_errors。非零/不完整快照不能当成功。stdout 仅给计数/输入字节摘要/范围说明，完整输出是对象数组。
6. `research_register` 使用该 execution_id、实际 output 路径、真实 input_ids 与 `recipe_paths:["bar_input.py","observe.py","source.json"]`。之后可 `report_data` 固定派生数据，或用 reports 直接引用原 market DataRef。没有观察时 row_count=0 是有效结果，不虚构信号。

## 严格边界

输入为 market_read 的完整 rows 数组：id/revision、datetime/end_time（原 SourceTime）、精确字符串 open/high/low/close、volume/volume_unit/volume_kind/volume_status、is_closed/closure。单个文件最多 8 MiB、10000 行，输出最多 8 MiB，不截断。拒绝 float/exponent/OHLC 越界、负量、重复 id/时间、重叠区间、混合来源时钟或量单位。价格可以为零或负值。形成中柱、未知 closure、显式 DST fold 不支持；不删除 fold 或伪闭以通过验证。

UTC 比较安全整数 unixMs；wall 保留 authority/zone/value，按同一显式来源钟面比较，不擅自换算时区。无法明确回拨/重复时刻顺序时应向提供方请求其支持的 UTC 或缩小范围。缺时钟就停止。跨休市/缺口不补柱，calendar continuity 仍未证明；关注原始 coverage 和返回间隔。

`event_time` 是事件位置，`confirmed_at` 是规则所需最后一根闭柱的源 end_time。它只是最早结构可知的下界，不是实际收到数据、下单或成交时间；历史 snapshot_observed_at 也不能冒充每根柱当时送达的时间。回测必须另有可得/撮合约定。

相同输入/参数生成相同观察；未来追加柱不会改变已确认事件。提供方修订旧柱、改变参数或改方法后必须生成新结果并保留旧报告；本地脚本不负责维护跨快照修订数据库。

## 教学演练

通过 plugin_read 读取 `examples/bars.json`、`examples/source.json` 写为本地文件，以同一命令执行，把 input 路径改为 bars.json。与 `examples/expected.md` 对照。这些数字明确虚构，ref=null，只有 demo 身份；不可把演练输出升级为 observed。
