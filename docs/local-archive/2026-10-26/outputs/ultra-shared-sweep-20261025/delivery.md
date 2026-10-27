# Ultra 同步扫光

文字与背景由同一个半透明光带扫过，文字没有独立动画周期。光带离开胶囊之后才进入下一轮；边框流光和关闭按钮保持原样。已更新当前 Sesame 前端，未重启后端或改变模式、草稿及插件。

动画检查：取样 0–3600 ms 的字形像素，确认光带经过时字形变色、离开后恢复、循环边界无残留；4800 ms 与前一轮 1200 ms 的取样相同。11 项 UI 检查通过，TypeScript、构建、lint 通过（保留原有体积和 Fast Refresh 警告）。

修改 ultra-status.css；ultra-status-ui.cjs 的布局测试先等待尺寸应用，再请求定位，消除测试设置的竞态。精确差异见 task.patch，真实程序核验见 live-verification.json。
