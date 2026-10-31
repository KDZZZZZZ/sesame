# 实际桌面导出验收：2026-10-20

结论：这两份下载没有发现新的正文截断。根助手的连续尾串检查分别遇到表格多列交错提取和一个既有分页字形问题。没有修改产品、业务报告、QA helper，也没有重新导出或调用实时应用。

## 证据

可重复运行 `verify_downloads.py`；完整逐项结果在 `acceptance.json`。输入仅为根助手已下载的跨市场 v3、量化 v1 PDF/TXT/PNG ZIP，UI 验收元数据及此前固定的隔离验收文件。

| 实际下载 | 结果 |
| --- | --- |
| 跨市场 v3 PDF | 9 页，标题正确，无空白页；`-raw` 提取匹配全部 16 个末单元格；黄金固定表格 114/114 行的全部 7 列按行连续匹配。 |
| 量化 v1 PDF | 13 页，标题正确，无空白页；13 页提取文本与隔离最终验收 PDF 逐页完全一致。 |
| 量化 v1 PNG ZIP | 3 张 PNG 与隔离最终验收图片逐字节一致，尺寸分别 1000×8000、1000×8000、1000×3092。 |
| 原 UI 折叠状态 | 元数据中跨市场 3 项、量化 21 项全部仍为 false。此处读取已有记录，没有操作 UI。 |

## 连续尾串失败点

### 跨市场：3 项为 `-layout` 跨列交错

零基索引：

- `table[2].lastCell[0]`：“QA均线和两条新绑定标注”
- `table[3].lastCell[0]`：“统一配置入口”
- `table[3].lastCell[1]`：“此前已打开入口；MT5有字段声明，AKShare和CCXT未声明统一字段。”

PDF 第 7 页的较窄列发生换行。`-layout` 先输出当前视觉行的相邻列，再输出下一视觉行，因此前两项的末字“注”“口”出现在其它列文本之后，第三项末段同理。去空白不能消除列间交错。对同一下载使用 TeXLive `pdftotext -raw -enc UTF-8`，16/16 项全部匹配，未去除标点。

Unicode NFKC 本身不能修复这 3 项。辅助 pypdf 对个别汉字存在兼容字形/文本顺序差异，所以不应把单个提取器的连续字符串匹配作为唯一完整性标准。

### 量化：第一个 pre 尾段跨第 4、5 页

25 项检查中，3 个表格尾段、其余 21 个 pre 尾段均匹配。仅 `codeTails[0]` 未连续匹配；原尾段含以下相邻字段：

```text
"schemaVersion": "1.0.0"
  },
  "implementation_sha256": "sha256:b4de5dc544e9f966c1ee5478db68602f14e24a04bcdc9dd6b029ac6e092987cd"
```

实际 PDF 第 4 页底部与第 5 页顶部把同一个闭括号字形分成上下片段，两页的文本流均记录该字形，提取后形成 `}\f},`。仅在这一已定位边界移除重复记录的一个 `}` 后，完整 180 字符尾串可精确匹配。result_ref 的尾值在第 4 页，完整 implementation_sha256 在第 5 页，没有尾段内容丢失。

这是确实存在的分页可读性瑕疵，不能称为单纯 Unicode 错误或无瑕疵排版；但它与此前隔离验收 PDF 完全相同，不能据此判定桌面部署引入了新截断。没有为本次诊断改代码。后续验收不能通过全局移除 JSON 标点来掩盖它。

## 可视证据

- [跨市场首页](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/market-page-1.png)
- [跨市场末页（第 9 页）](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/market-page-9.png)
- [量化首页](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/quant-page-1.png)
- [量化末页（第 13 页）](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/quant-page-13.png)
- [量化第 4 页底部的括号片段](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/quant-page-4-bottom.png)
- [量化第 5 页顶部与完整实现哈希](E:/brief2great/sesame/outputs/live-plugin-qa-real-pdf-acceptance-20261020/quant-page-5-top.png)

首页/末页由实际下载 PDF 经 Poppler 渲染，已人工查看，末页内容可见且没有空白尾页。以上证据证明指定尾部和黄金全表保留，并与隔离验收逐页/逐图对照；不等于逐字审核全部报告的语义或排版。
