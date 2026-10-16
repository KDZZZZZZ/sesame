import { capability } from '@sesame/plugin-sdk/capabilities';
import { targetProfile, registerTranslation } from '../backend/target.js';
import { registerTranslationFile } from '../backend/translation-file.js';
import { translationProperties, translationFileProperties } from '../backend/translation-input.js';
import { prepareConformance, verifyConformance } from '../backend/conformance.js';
import { requireValue } from '../backend/support.js';
export function createCapabilities(host, mt5) {
  return [
    capability('mt5_target', () => targetProfile(host)),
    capability('mt5_translation', args => registerTranslation(host, mt5, args)),
    capability('mt5_translation_file', (args, signal) => registerTranslationFile(host, mt5, args, signal)),
    capability('mt5_conformance', (args, signal) => {
      const fields = args.action === 'prepare' ? ['action', 'operation_id', 'source', 'fixture_path', 'header_path', 'timeline_path', 'tolerances'] : ['action', 'operation_id', 'fixture', 'translation', 'result'];
      requireValue(Object.keys(args).every(key => fields.includes(key)) && (args.action === 'prepare' ? args.source && args.fixture_path : args.fixture && args.translation && args.result), 'conformance动作参数不完整或包含其他动作字段');
      signal?.throwIfAborted();
      return args.action === 'prepare' ? prepareConformance(host, args, signal) : verifyConformance(host, mt5, args);
    }),
  ];
}
