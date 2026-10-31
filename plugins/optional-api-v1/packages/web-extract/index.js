import { capability } from '@sesame/plugin-sdk/capabilities';
import { parse } from './parser.js';
export const createCapabilities = host => [capability('extract_webpage', (input, signal) => parse(host, 'extract_webpage', 'html_content', input, signal))];
