# 动态报告附件链接修复交接

状态：源码修复已本地提交，主任务部署后的**一次真实桌面三附件下载验收通过；联合隔离fixture仍未全绿**。按主任务指示停止追加排查和重跑。本子任务没有改正在运行的安装、报告、模型或用户数据。

提交：`ed7c46d27634dc00bd1a91b62d98ccbb2ccb4a08`，只含 `modules/frontend/report-runtime/artifact-host.js` 和 `tests/report-attachment-links.test.js`。精确补丁为 `dynamic-attachments.patch`，SHA256 `0cd99d636fbfb1b26d0eab97a2785d449770ae2ec445fc41326c536ebdb92dd5`。

## 已证原因与最小改动

已部署版本只在 inlinePackage 扫描初始HTML。真实报告v3的三个附件a由报告JS随后生成，没有 `data-report-resource`，已有点击桥无法识别。隔离fixture先复现同样的三条原始相对href与空绑定；动态嵌套入口同样失败。

修复复用同一相对路径与固定包登记检查：初始HTML、运行时新增/替换节点、href变化均走同一绑定函数。监听只处理变化子树和href，并在点击时同步复核。href改成外链、未登记路径或带query时清除旧附件绑定。现有固定manifest的字节/大小/digest校验、opaque sandbox、CSP、可信click、宿主userActivation检查及下载MIME不变；不增加公共API或权限。

有效动态链接在静态打印前也改为 `#`，避免落到宿主 `/evidence/`。打印不会自动下载附件，独立PDF/PNG仍不包含JSON附件。

## 测试结果与明确缺口

| 证据 | 实际结果 |
| --- | --- |
| `regression-red.log` | 改产品前14项中8通过、6失败；Chromium/Electron均复现动态链接未绑定，包含父测试连带失败 |
| `regression-green.log` | 文件名为首次修后运行名，**实际37项中35通过、2失败**；Electron首个动态下载3秒内没有DownloadItem，父测试连带失败 |
| `electron-recheck.log` | 同一产品/测试版本，Electron单独7/7通过，使用真实DownloadItem完成及内容hash |
| `regression-final.log` | 一次联合确认仍35/37；同一Electron动态下载失败，其余通过。到此停止，不调高超时、不放宽断言、不继续循环 |

Chromium动态生成、替换、href变化、精确下载字节、合成点击拒绝及静态打印均通过；现有导出、安全和frame-policy回归通过。Node语法、针对性oxlint、git diff whitespace检查通过。Electron单跑成功不能覆盖联合fixture的不稳定；下节真实桌面正向证据也不将该隔离失败改写为通过。未执行的临时诊断插桩已撤回，提交内容与上述测试版本一致。

## 交付与一次真实复验

唯一需部署产品文件：`E:/brief2great/sesame/mt5agent/modules/frontend/report-runtime/artifact-host.js`。

- 旧已部署SHA256：`70f02aef0a27c7c5d56b8d90c9ecbac25fd09b46d6e1950590af14cf55fa8605`
- 新SHA256：`75397f925a0d1887cae30fbb39095e09f3fa2ccdb9b5d864cf0c7bd1d9fb630b`
- 无需前端构建或插件更新。宿主的report-inspection缓存运行时源码，沿主任务已授权的空闲维护流程重新载入；本子任务未部署。

主任务已完成host-only空闲维护，并于14:42:13.776Z在原报告中展开附件折叠区、真实点击下载三个文件。`../live-plugin-qa-20261020/report-attachment-links-after.json`记录三条href均为`#`、绑定原登记资源，固定revision3：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| evidence-ledger.json | 34572 | ba7b4536ce63c39be6b0e599f340bec54a15a58c3f4e14151b50d3c7dc3ad560 |
| calculation-ledger.json | 407581 | ca6c747116a71b7f40f0800a8937e237b33cf9d13b0df67ab04a4a42ed38407b |
| methods-ledger.json | 92879 | f14e82c70ed7e8fdd1fb5eda5fcb90de28dbc1c2163289c4b45d0009aa84d042 |

三文件与原manifest逐一匹配，JSON有效；pageErrors、strayRequests均为空，原报告仍打开。截图为同目录report-attachment-links-after.png，下载保存在downloads-evidence-attachments。主任务报告该次维护55 ready/9暂停保留。这里仅增加真实UI正向验收，不覆盖上面的联合fixture不稳定，也不扩大到所有reports能力通过；不再重跑。
