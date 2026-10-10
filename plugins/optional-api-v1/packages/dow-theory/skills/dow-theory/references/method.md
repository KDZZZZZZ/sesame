# Dow Theory：选择版本与确认

Dow 的报刊观察经 Hamilton、Rhea 等整理为不同版本。Hamilton《The Stock Market Barometer》由 Harper & Brothers 于 1922 年出版，大学书目可核查。CMT Association 2011 年刊载的 Robert W. Colby/Paul Shread 等作者文章明确讨论多个 averages 的收盘确认和定义差异。[书目](https://onlinebooks.library.upenn.edu/webbin/book/lookupname?c=x&key=Hamilton%2C+William+Peter%2C+1867-1929)；[作者文章](https://cmtassociation.org/technically_speaking/technically-speaking-october-2011/)。

本包用“既定次级反应的收盘极值被两指数各自确认”作研究步骤，不把它宣称为所有历史版本的唯一机械规则。原文章中的收益试算、无成本假设及市场心理描述不作为本插件验证结果。

## 操作表

| 项目 | 应保留的事实 |
| --- | --- |
| 主要趋势假设 | 截止前证据、采用版本、失效规则 |
| 每条次级反应 | 选择规则、起止锚点、确认时刻、close 极值 |
| 第一指数确认 | 实际闭市时间、收盘值、源 ref、越过条件 |
| 第二指数确认 | 同上；允许不同日期，不造缺失行情 |
| 共同确认 | 两项均实际可得后的时间；不能回填至第一项 |
| 非确认 | 哪项缺失/未越过；不是已确认反转 |

不要把两序列相同下标当同一时刻；市场假期和时钟不同须用明确日历/SourceTime 对齐，未知就保持未确认。仅一个资产的一串高低点不足以声称完成 averages 的共同确认。用户要求代用指数时说明成分、市场覆盖与制度差异，将其命名为改编并单独验证。

次级反应选择含主观性时，输出人工候选和锚点版本，不隐藏在“自动 Dow 信号”名称后。本包没有机械判整个长期牛熊周期或安装数据后端。
