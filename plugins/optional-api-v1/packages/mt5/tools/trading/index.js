import { officialTool } from '../../backend/plugin-tools.js';
export function createTools(host, mt5) { return [officialTool(host, mt5, 'trading')]; }
