import { officialTool } from '../../backend/plugin-tools.js';
export function createCapabilities(host, mt5) { return [officialTool(host, mt5, 'python')]; }
