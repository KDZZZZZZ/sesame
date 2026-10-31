import { capability } from '@sesame/plugin-sdk/capabilities';
import { parse } from './parser.js';
export const createCapabilities = host => [capability('parse_feed', (input, signal) => parse(host, 'parse_feed', 'xml_content', input, signal))];
