# 插件集成验证（2026-10-18）

本轮先执行完整集成验证，再按授权恢复 MT5 能力描述中的具体输入形状，并刷新可选插件锁。Kurumi 原锁条目保持不变；未修改用户数据，未启动真实模型或交易。

## 执行方式

```powershell
$env:SESAME_PLUGIN_SDK_LOADER='file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js'
$env:SESAME_HOST_ROOT='E:/brief2great/sesame/mt5agent'
node plugins/optional-api-v1/scripts/test.mjs
node plugins/api-v1/scripts/test.mjs --sdk
```

两套均已完整结束，不能报告全量通过。

| 范围 | 总项数 | 通过 | 失败 | 跳过 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 可选插件全套 Node | 887 | 732 | 133 | 22 | 278 秒 |
| 核心插件 SDK 全套 | 629 | 590 | 26 | 13 | 186 秒 |

## 本轮新增回归

`plugins/api-v1/tests/mt5-runtime-repairs.test.js:232` 要求 `mt5_catalog.description` 明示 `server:"tester"` 形状。本轮文案保留 tester 别名语义，但曾删掉字面输入形状，造成 1 项断言失败。现已恢复具体形状；重新执行该测试文件，56/56 通过，0 失败、0 跳过。未重复执行两套完整测试，上表保留第一次全量运行的真实计数。

```powershell
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/api-v1/tests/mt5-runtime-repairs.test.js
```

## 既存失败分类

可选插件 133 项失败归属既存测试/开发状态：

- 127 项来自未发布的 Kurumi 测试；包含旧 createTools 导出、Windows 旧 URL 路径拼接及其他旧测试夹具。Kurumi 本来已有未提交变更，本轮未触碰。
- 2 项 CCXT 旧宿主测试仍在 provider implementation 上替换 `.call` / `.host`，实际 API 2 已使用能力适配入口。对应测试、CCXT 执行代码和宿主 providers 本轮均无修改。
- 1 项 manual-trading 测试仍要求宿主最低版本 `>=0.2.3`，实际已发布为 `>=0.2.4`。
- 2 项方法宿主测试在普通工具列表中寻找旧 `plugin_test` 入口。
- 1 项 QMT 宿主测试导入已删除的 `modules/plugins/context.js`。

核心其余 25 项：

- 18 项 memory-compaction-host 旧夹具未加载 capabilityManifest，直接注册旧入口，报 `names is not iterable`；memory 与该测试本轮均无修改。
- 2 项旧 context.js 导入，1 项旧 createTools 调用。
- 2 项旧凭据测试仍禁止已上线的直接密码配置及 Schema 的 password/token 字段。
- 1 项 catalog-engine-compat 硬编码用宿主 0.2.3 接纳已要求 >=0.2.4 的 manual-trading。
- 1 项 catalog-sources 历史 API 1 / Git 历史基线。

当前 API 2 宿主集成中，ABU 全套安装/隔离/重启、自动因子工作流、手动交易工作流、数据/账户能力等测试已通过。各失败的原始位置与错误分别保存在 JSON 清单中，完整栈在日志中。

## 锁与来源

恢复 MT5 描述后重新生成可选锁，保留 Kurumi 原条目（treeDigest: `sha256:52fd8546063cc0b146e2c492c3095bacc5b1a7f6bf0661d1ba20781ccc4627b1`）。相对刷新前，本次锁更新覆盖最新源码中的 manual-trading 与 mt5。核心 9 包完全匹配锁；可选 46 包仅 Kurumi 五个原有开发文件与锁不符，其余 45 包匹配。MT5 描述和可选锁的 `git diff --check` 通过。

## 文件

- `optional-integration-node.log` / `optional-integration-failures.json`
- `core-integration-sdk.log` / `core-integration-failures.json`
- `integration-lock-diff.json`

- `mt5-runtime-repairs-recheck.log`（56/56 通过）
- `optional-lock-refresh.json`（锁刷新与 Kurumi 保留回执）
- `information-layer-final-diff-check.log`
