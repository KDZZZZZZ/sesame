插件只有通过完整静态声明的能力才可调用。发现插件使用 plugin_discover，读取声明用 plugin_read(part:"manifest")，读取知识用 part:"resource"。安装一次调用 plugin_install，宿主在内部执行检查、测试和精确摘要安装；更新使用 plugin_update 与当前 expectedRevision。无需让 Agent 手工执行 validate → test → install 链。

开发前读取 develop-plugins skill。plugin_create 生成 API 2 完整声明，业务实现完成后再安装。原生入口只导出 createCapabilities(host)，全部函数和 Agent、宿主 source/view/service/hook、state/artifact schema 与知识资源均在 capabilities.json 明示。纯知识包执行能力为空。

plugin_catalog 只接受 API 2 固定发布目录，API 1 目录会返回真实版本错误。安装目录包需固定 catalog_digest；升级必须显式 action:update。安装与配置依赖仍以真实回执为准。
