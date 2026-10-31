# 空图来源恢复按钮布局修复

已完成一次小修，源码稳定，供 root 后续统一构建。没有操作真实桌面、数据、配置，没有构建、部署或提交。

- `chart-window.tsx`：仅在来源版本改变且没有 K 线时，将原有来源警告和 SourceRecoveryControl 一起放入 plot 中部，避免与固定品牌岛重叠；去掉此状态下重复的泛用空图占位文案。有 K 线时保留现有顶部布局。
- `canvas.css`：4 个局部选择器，为恢复区预留顶部品牌和底部工具栏空间，限制文本宽度，窄窗允许滚动。品牌和工具栏规则未改。
- `source-recovery-control.tsx` 字节未变；恢复流程、账户/品种/时钟核验、CAS、绘图、脚本和绑定数据未变。
- `tests/chart-source-recovery-layout.test.js`：独立 Chromium/Vite，真实 ChartWindow、PriceChart、样式和鼠标点击，模拟离线来源，不连接真实应用。测试 876×707、360×420 两个窗口，验证没有自动恢复、命中目标按钮、点击只进入一次原流程、失败诊断显示、没有保存写入及没有页面错误。

## 证据

- `red.log`：修前回归准确失败，`recovery click intercepted by canvas-glass-island canvas-brand-island`。按钮中心位于品牌岛内。
- `green.log`：相同回归通过，2 个窗口均完成真实鼠标点击。
- `contracts.log`：现有恢复单元与 Electron UI 测试 25/25 通过，包含冲突、绘图与固定数据保留。
- `typecheck.log`：`npx tsc -p modules/frontend/tsconfig.app.json --noEmit --incremental false`，退出 0。
- 目标 oxlint、`git diff --check`、完整补丁 `git apply --reverse --check` 均退出 0。
- `red/876.png`、`green/876.png`、`green/360.png` 已目视核验；对应 JSON 保存点击命中几何。

## 精确交接

- `source-recovery-layout-product.patch`：相对本次 `.before` 的 2 个产品文件增量。
- `source-recovery-layout.patch`：上述增量与新回归测试。
- `hashes.json`：基线/最终 SHA256。基线 HEAD 为 `1f0eb03028f5b06ae4625f74cbc60478ec815072`，工作树此前已有修改；不要把这些文件相对 HEAD 的整份差异归为本次修复。
- 产品 SHA256：
  - `modules/frontend/src/features/canvas/chart-window.tsx`：`fd432cfa2c563d7e64a9ca28bfb84f8a6fdd538d6aa6214d9a09b8dc4a8b9bbc`
  - `modules/frontend/src/features/canvas/canvas.css`：`eb87b73f035f5731bcc5705c327deea27935b8a3d79b822c3ec180155fd5fce9`

最终真实桌面鼠标验收待 root 在后续构建部署后执行；隔离 UI 通过不替代此项现场验收。
