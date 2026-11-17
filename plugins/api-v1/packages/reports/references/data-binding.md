# 固定数据与附件

图表 rows 与 data_id 二选一。rows 是最多 2500 条已有对象记录，columns 可省略并从真实数据推导；options 映射源字段，不改数值、重采样或计算指标。

data_id 匹配外壳 data:[{id,ref,usage}] 的 id。ref 保持完整 id/revision/digest/kind/schemaVersion，固定数据使用 json-rows。独立节点用 nodes 或 chart_data:[{property:"nodes",data_id}]，不同时提交。

references/related 使用完整固定身份，demo 来源不能改标真实。attachments.items:[{label,path}] 的 path 匹配 assets 的包内相对路径。资产来自 source_path，或精确 ref+entry；固定资产 ref 同时列入 references。只接收 JSON、文本和 PNG/JPEG/WebP，MIME 与扩展名一致；不接收脚本、SVG、HTML。

长完整输入可用 input_ref:{ref,entry}，不另提供 content/style/assets/target。修订不重新抄录精度敏感数据。
