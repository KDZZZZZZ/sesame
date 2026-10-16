import { createCapabilities as data } from './tools.js';
import { createCapabilities as research } from './research-tools.js';
export const createCapabilities = host => [...data(host), ...research(host)];
