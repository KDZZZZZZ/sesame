import { targetProfile, registerTranslation } from '../backend/target.js';
import { registerTranslationFile } from '../backend/translation-file.js';
import { translationProperties, translationFileProperties } from '../backend/translation-input.js';
export function createTools(host, mt5) {
  const { define } = host.tools;
  return [
    define('mt5_target', '读取并冻结 MQL5 目标 profile、数值/事件/恢复限制及包内翻译说明。先保存 SVL 并由宿主从源生成图，再依目标翻译；本工具不编译、不回测、不交易。', {}, () => targetProfile(host)),
    define('mt5_translation', '将 Agent 按冻结 SVL 源编写的 MQL5 文件、逐节点 source_map 与适配说明登记为翻译成果和独立 MT5 工程。较长源码请在工作区写 JSON 清单后用 mt5_translation_file，避免全文重发。只检查身份与映射结构；结果 partial，不证明原生语义等价。逻辑变化先修 SVL，再创建新翻译。', translationProperties, args => registerTranslation(host, mt5, args)),
    define('mt5_translation_file', '以短参数登记当前工作区内的 UTF-8 JSON 清单（≤8 MiB）：结构与 mt5_translation 相同，但不含 operation_id；files 内嵌源码文本，不扫描目录。同样严格校验源、目标、参数和映射。首次读取后固定输入；相同操作 ID/路径重试直接复用快照，不重读文件，即使文件已删除。修改内容需新操作 ID。返回成果引用/摘要，不回全文；不编译、不启动终端、不交易。', translationFileProperties, (args, signal) => registerTranslationFile(host, mt5, args, signal)),
  ];
}
