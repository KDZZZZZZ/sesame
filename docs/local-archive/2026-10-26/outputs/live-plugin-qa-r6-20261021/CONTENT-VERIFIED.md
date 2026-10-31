# R6 文件与 Atom 独立内容核验

状态：**passed_with_limits**。回执冻结于 2026-10-21T08:59:52.474Z；本核验时间 2026-10-21T09:00:47.008Z。这是限定内容验收，不代表主 Agent 已 idle、CCXT 或整个 R6 已完成。

| 验证项 | 状态 | 说明 |
| --- | --- | --- |
| 冻结回执可读 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 初始全文、字节与摘要 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 五页边界与全文重组 | passed | 1/17/33/49/65，完整重组含末尾 LF |
| 精确编辑只改变物理第33行 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 移动及实际完成的逐字节复制 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 仅删除本轮副本，最终文件保持 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 冻结Atom原文、固定引用与实际来源摘要 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |
| 实际rss-collect输出与原文前两条字段 | passed | 真实 rss-collect 3.0.1：原文10项/返回2项，标题、链接、ID及更新时间相符 |
| Agent归档与实际回执交叉一致 | passed | 详见 JSON 中的实际 callId、Run、字段或摘要断言 |

已核验：初始文件3442字节，五页实际read逐页匹配初始write全文并重组成相同内容。精确编辑只改变物理第33行，结果3444字节；实际move、完成的copy Run、摘要保护的remove和当前最终文件逐项交叉核对。

复制证据来自真实host.process.exec完成结果及其保存文件，不把accepted当成功，也不声称专用copy API通过。Atom结果必须来自实际 `sesame/rss-collect#parse_feed` 回执；标准库脚本的自制解析结论不能替代它。

已核验：原始Atom文件166916字节，重算SHA-256等于来源回执data_hash；与物化JSON自身摘要分开。原文10项，实际插件限量返回2项。前两条原文均无published，输出published映射自updated，只能按更新时间解释。

- Only the captured receipts and current R6 work files are observed; main Agent idle and overall R6/CCXT outcome are not asserted.
- Copy uses the actually recorded host.process.exec and Python shutil.copyfile; this does not test a dedicated copy API.
- The deleted copy cannot be reread now: its bytes are supported by completed process output, the matching saved transcript and a guarded remove receipt.
- The fifth read page is the trailing LF empty segment at offset 65, lines=1, next_offset=null; it is not a missing content line.
- Atom published output maps from raw updated when raw published is absent; it is not evidence of original publication time.
- Atom max_entries=2 limits a ten-entry frozen input; this is not pagination, a large-output budget test or a complete release history.
- The small Atom result has no separate derived result_ref; the original full source_ref is retained.
- Raw Atom field extraction below is bounded to this plain default-namespace fixture. Actual plugin output is required and is never replaced by this check.
- ArtifactRef identity is compared across actual receipts. No source manifest bytes were captured here, so its manifest digest is not independently rehashed.
- No delete/recreate recovery, rejected-edit, hash-conflict removal or overwrite branch is covered; no whole-plugin pass is claimed.

证据：[冻结根回执](E:/brief2great/sesame/outputs/live-plugin-qa-r6-20261021/receipts.json)、[逐项机器结果](E:/brief2great/sesame/outputs/live-plugin-qa-r6-20261021/content-verified.json)、[只读验证脚本](E:/brief2great/sesame/outputs/live-plugin-qa-r6-20261021/verify-contents.mjs)、[本轮文件回执](%LOCAL_USER_PROFILE%)、[复制完成证据](%LOCAL_USER_PROFILE%)、[Atom回执](%LOCAL_USER_PROFILE%)、[冻结Atom原文](%LOCAL_USER_PROFILE%)。

重跑：node outputs/live-plugin-qa-r6-20261021/verify-contents.mjs。只更新本目录content-verified.json和CONTENT-VERIFIED.md，不触碰业务文件、应用、数据库或网络。
