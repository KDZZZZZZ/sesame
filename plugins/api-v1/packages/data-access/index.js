import { createTools as access } from './tools.js';
import { createTools as research } from './research-tools.js';
export function createTools(host) { return [...access(host), ...research(host)]; }
