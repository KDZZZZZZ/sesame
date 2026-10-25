import { capability } from '@sesame/plugin-sdk/capabilities';
import { parse } from './parser.js';
export const createCapabilities = host => [
  capability('parse_fx_json', (input, signal) => parse(host, 'parse_fx_json', 'json_content', input, signal)),
  capability('parse_fx_xml', (input, signal) => parse(host, 'parse_fx_xml', 'xml_content', input, signal)),
];
