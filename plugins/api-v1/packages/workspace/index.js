import { createCapabilities as workspace } from './tools.js';
import { createCapabilities as external } from './host-files.js';
export const createCapabilities = host => [...workspace(host), ...external(host)];
