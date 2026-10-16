import { capability } from '@sesame/plugin-sdk/capabilities';
import { changesSchema, commandSchema, importProperties, readConfiguration, updateConfiguration, importConfiguration } from '../backend/configuration.js';
import { connectMT5 } from '../backend/connect.js';

export function createCapabilities(host, mt5, imports) {
  return [
    capability('mt5_settings', () => readConfiguration(mt5, imports)),
    capability('mt5_update_configuration', args => updateConfiguration(host, mt5, args)),
    capability('mt5_import_configuration', args => importConfiguration(host, mt5, imports, args)),
    capability('mt5_connect', (args, signal) => connectMT5(host, mt5, args, signal)),
  ];
}
