import { createTools as workspace } from './tools.js';
import { createTools as hostFiles } from './host-files.js';
export function createTools(host) { return [...workspace(host), ...hostFiles(host)]; }
