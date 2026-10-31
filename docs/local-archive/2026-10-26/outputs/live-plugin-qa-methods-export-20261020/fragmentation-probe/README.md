# 量化 PDF 分页拆字：有界修复调查

本轮没有修改产品文件，未部署，未操作实际桌面或访问子库。冻结报告及资源预算保持原样。

## 确认根因

宿主打印固定全高的隔离 iframe。Chromium 将 iframe 内容按纸张边界裁切，未按内部 `pre` 行盒重新分页。真实量化 PDF 第 4/5 页同一个闭括号被切成两片；两页文本流各记录一次。

冻结量化报告中第一个 pre 高约 511px，祖先均为正常块布局、`overflow:visible`、`contain:none`。不存在仍未解除的固定 pre 高度或滚动裁切。

## 已完成的小范围尝试

| 导出副本调整 | 高度 | PDF 大小 | 结果 |
| --- | ---: | ---: | --- |
| 当前实现 | 18,695px | 1,464,038 B | 第 4/5 页拆字 |
| `pre` 的 `break-inside:auto`、`widows/orphans:3` | 18,695px | 1,464,038 B | 相同拆字 |
| `pre` 的 `break-inside:avoid`、`page-break-inside:avoid` | 18,695px | 1,464,038 B | 相同拆字 |
| `details` 和 `::details-content` 改 `display:contents` | 18,518px | 1,463,638 B | 仍在第 4/5 页拆字 |
| 对当前已渲染 iframe 的 CDP target 调用 `Page.printToPDF` | — | — | 平台返回 `'Page.printToPDF' wasn't found` |

这些是隔离测试副本，均未写入产品或报告。

## 独立复现

相同的 230 行、16px/21px 字体合成文本：

- 通过现有 iframe 导出，所有 230 行在，但第 68、137 行额外产生跨页字形残片 `LINE068ENDLINE137END`。
- 作为独立顶层合成页面打印，提取结果与预期 230 行精确一致，没有残片。

两个控制使用同一 Electron、打印参数和文本；顶层控制仅用于诊断，未把真实业务报告搬到宿主执行。

截图可直接比较：

- [iframe 第 1 页底部：最后一行被截](E:/brief2great/sesame/outputs/live-plugin-qa-methods-export-20261020/fragmentation-probe/frame-page-1-bottom.png)
- [顶层控制第 1 页底部：完整行分页](E:/brief2great/sesame/outputs/live-plugin-qa-methods-export-20261020/fragmentation-probe/root-page-1-bottom.png)

`verify_fragmentation.py` 校验证据并生成 `proof.json`；附加 `--assert-fixed` 可重复得到当前缺陷的失败断言。未往仓库测试套件加入一个明知失败、又没有可靠修复的测试。

## 限制和后续边界

已排除普通分页 CSS、details 内容盒、未解除的固定 pre 高度。调节当前报告的行高或空白只能移动裁切位置，不能保证其它页或内容正确，因此没有采用。

可靠修复需要让完整报告本身成为可分页的打印目标，并保持现有沙箱、固定数据桥、脚本/图形状态与资源限制；当前 adapter 不能直接打印 opaque child target。这涉及打印页面结构或目标的变更，超出这轮小范围 CSS 修复。未尝试 DOM 搬运、自制分页或放宽预算。

产品文件哈希保持已部署版本，PNG 路径和表格/details 行为未更改。本轮没有重复宣称已修复，也未重跑与未修改产品无关的全套测试。
