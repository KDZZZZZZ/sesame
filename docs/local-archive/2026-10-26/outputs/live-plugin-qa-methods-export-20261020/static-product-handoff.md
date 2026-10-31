# 静态 PDF 分页修复交接

2026-10-20。仅源码与隔离回归；未操作真实桌面、数据库、模型、报告或部署，未 commit。

## 产品文件与部署

以下路径相对 `E:/brief2great/sesame/mt5agent`：

| 文件 | SHA256 | 桌面需要 |
|---|---|---|
| `modules/agent/report-export-renderer.js` | `a0b386c030a3353d8c027572c702724a003d9cbb87b24d55dfced20dbd90fac5` | 是 |
| `modules/agent/report-export-static.js`（新文件） | `a13756d5dd45ca4752edc9cb4bcb8429606c365f471b7f416066e2e53f14af10` | 是 |
| `modules/frontend/electron/report-renderer.js` | `604ee06d6878f4688b87ed1e1a700c3ffe44bd56ca3558df14ea01d02d708fab` | 是 |
| `modules/agent/report-playwright.js` | `48c6b4e33c55107997b2941e7b463a11669af22cfdf6d0ed993904f5e8f33bda` | 否，开发/独立 Node 服务使用 |

桌面包原本不包含 `report-playwright.js`，实际 Electron 导出不会执行它；源码两种 adapter 已同步。唯一新增 import 是私有 helper：Electron 使用 `../../agent/report-export-static.js`，Playwright 使用 `./report-export-static.js`。无新依赖。

本次不需要重建前端 bundle；其他 lane 的前端变更由 root 统一构建。

## 精确增量与已有改动边界

`static-pagination.patch` 是**本轮分页修复的四个产品文件增量**，相对修复前已安装/已验证源码；SHA256：

`0a7a88335174625597af7d97da9a2efe62520f423bd5ee8bb906ff8b0c3aec28`

已在当前工作区执行 `git apply --reverse --check <patch>`，通过；没有实际应用或反向应用。对应三份基线保存于 `static-product-baseline/`：

| 基线 | SHA256 |
|---|---|
| `report-export-renderer.js` | `06d7ae1a31958c4330224d5efb17567caa33ad5e3978f09d69e9e30057b17d75` |
| `electron-report-renderer.js` | `4870c617b216169cfa47358deca80fdd340d815a63682708e463275f92ab6bc9` |
| `report-playwright.js` | `6ccaef345551e98fb43568bb94be886f59e644e9bef83eef9303475a724f4df0` |

前两份直接读取当前已安装包，第三份从本次变更反推；**三份 SHA 均与实施前 POC 保存的源码 SHA 完全一致**。新 helper 在基线不存在。

当前 HEAD 尚不含共享导出 renderer 和部分导出测试，因此不能把完整 `git diff HEAD` 当作这个分页 bug。精确范围：

- 共享 renderer：稳定测量分支更新完整 `size`；PDF 分支添加静态切页、字体/图像就绪、正文与布局一致性和同一预算复核。原有标题、details 展开、滚动区域释放、打印媒体、PNG 分片、取消/超时均是前序改动，未在本轮重新实现。
- Electron adapter：仅新增 helper import 和 `staticDocument` 方法。相对 HEAD 的 Windows 私有内存计量、资源错误透传、`render/export`、`printMedia`、`capture/pdf` 等均是前序已安装改动。
- Playwright adapter：新增 helper import；`page/cdp` 改为可更新引用；新增 `staticDocument`；关闭 context 的 Promise 复用以保证切页取消真正等待结束。相对 HEAD 的 `render/export`、CDP、打印/截图等为前序支持。
- 新 helper：全部为本轮内容。

提交时先保留/提交依赖的导出基础，再使用此增量划分静态分页修复；本子任务没有操作 index。

## 行为与安全边界

原始隔离 iframe 按已有规则完成报告数据、details 和动态行展开后，PDF 把同步冻结的 DOM 复制到同一隔离环境的新顶层文档分页。SVG 和 CSSOM 保留，2D canvas/已加载 blob 图片冻结为 PNG，嵌入 CSS 字体保留；不重放 authored JS。

可信 Node adapter 先写严格 CSP，并将原始快照作为转义的惰性 textarea 装载。新无脚本 realm 的 DOMParser 清除 script、事件属性、base、meta refresh、frame/object/embed、导航属性等，再安装 DOM。因此不信任原报告可改写的 DOM serializer。

Electron 导航丢弃旧 realm/桥/MessagePort/定时器；Playwright 使用新 page，避免 `exposeFunction` 跨导航残留。静态页 opaque origin，脚本和网络连接均禁止，图像/字体只准 data。既有沙箱、网络边界、取消/45 秒、384 MiB watchdog、64k 高、64M 像素、32 MiB 输出预算保留。watchdog 是周期采样，并非 OS 硬上限。

无法可靠冻结时明确拒绝：CDP 检出的 open/closed author shadow DOM、转移的 canvas、非保留 drawing buffer 的 WebGL、运行时无 CSS 来源字体、SMIL/音视频状态、残留非图像 blob 资源。静态副本正文/尺寸发生变化也拒绝，避免成功但缺内容。

## 回归与证据

- `node --test tests/report-export-renderer.test.js`：21/21 通过。
- `node --test tests/electron-report.test.js`：20 个真实 Chromium/utility IPC 检查全部通过，Electron 44.5.1 / Chromium 152.0.7977.130。
- 产品四文件 oxlint：0 警告、0 错误；全部目标测试文件 lint 返回 0，但保留三项本轮之前即存在的测试警告（两个 unused expression、一个 unused `_` 参数）。
- `git diff --check` 指定目标文件通过。
- `static-product-red-green/proof.json`：用 SHA 确认的旧 renderer 与新 renderer 同跑真实浏览器。230 行应为 2760 字符；旧 PDF 产生 2780 个 glyph（页边界碎片），新 PDF 恰为 2760，每页均为完整行，均为 4 页。原/新 PDF 和文字均保存。
- `static-product-proof.json`：冻结真实 QA 报告的完整成品验证和全部源码 SHA。

| 冻结报告 | 结果 |
|---|---|
| 量化方法 v1 | 14 页，18,695px，1,461,652 字节；22 个 pre 全文、115 个实际 `td/th` 全部提取成功；静态前后正文、尺寸、字体状态、SVG 相同；无空页 |
| 跨市场 v3 | 9 页，12,164px，1,042,819 字节；1 个 pre、853 个实际 `td/th` 全部提取成功；同样保真且无空页 |
| 量化 PNG | 3 张与修复前基线 SHA256 逐张相同 |
| 证据 v2 | PDF 340,249px / PNG 341,613px，均在快照之前按 64k 拒绝，无导出文件 |

实际 `td/th` 数量与旧按表格文字拆分的 117/854 数不同；这次按真实元素核验。所有冻结输入 SHA 不变。40ms 隔离采样最大私有占用 199.94 MiB。

视觉复核：`static-product-visual/quant-methods-04.png`、`quant-methods-05.png` 的同一个右括号不再拆页；`quant-methods-14.png` 显示真实尾部，无空尾页。跨市场首/末页也在该目录。

测试文件的本轮范围：

- `tests/fixtures/report-export-proof.js`：新增 pagination fixture 和单字体 glyph 解码器，原 PNG 像素验证器不变。
- `tests/report-export-renderer.test.js`：新增 5 个测试（整行分页、canvas/blob/CSSOM/字体、不可冻结状态、静态页安全、切页取消）；原有两个 PDF DOM 断言改为在顶层读取，PNG 仍读 iframe。
- `tests/fixtures/report-renderer-electron.cjs`：新增 4 个 static PDF 检查；前序并发中文 PDF 断言改读顶层。
- `tests/electron-report.test.js`：本轮计数从 16/17 改到 20/21，HEAD 的 12/13 是更早基线。

其他产品或插件文件未在本轮修改。
