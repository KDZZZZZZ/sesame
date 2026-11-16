# 固定数据的局部交互

交互写在现有 group/table/chart 中，只筛选、选择和展示已提供记录，不运行研究或交易。

```js
{ type:"group", layout:"stack",
  controls:[{id:"symbol",label:"品种",kind:"select",options:[{value:"A"},{value:"B"}],value:"A"}],
  blocks:[{type:"chart",kind:"line",rows:[{symbol:"A",time:1,value:2},{symbol:"B",time:1,value:4}],
    options:{x:"time",y:"value",xType:"number"},filter:[{field:"symbol",control:"symbol"}]}]
}
```

控制器仅作用于当前 group 子块；带自己 controls 的嵌套 group 建立独立作用域，同名 id 不串联。

- select：固定 options:[{value,label?}] 与初始 value，保留原始标量。
- range：{id,label,kind:"range",min,max,value:[from,to],step?,format?:"number"|"time"}。时间范围用 Unix 毫秒，源列可为毫秒或日期时间字符串。多图引用同一控制器即可共享范围。
- chart/table.filter:[{field,control,operator?:"eq"|"between"}]。eq 配 select，between 配 range；未匹配保留空结果。
- chart.option_controls:{y:"metric"} 切换已提供列；也支持 x/value/focus/frame，值来自固定选项，不接受函数。
- table.selection:{column:"id",control:"selected"} 点击或键盘选记录，联动同组图。page_size 为 1–200；打印包含当前筛选全部记录，返回页面恢复分页。

参数试验、敏感性图、品种和周期切换使用这些通用字段，生产者决定显示哪些已计算结果。
