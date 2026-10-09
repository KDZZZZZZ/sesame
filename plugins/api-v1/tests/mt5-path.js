import { fileURLToPath } from 'node:url';
export const mt5Import = path => import(new URL(`../packages/mt5/backend/${path}`, import.meta.url));
export const mt5Path = path => fileURLToPath(new URL(`../packages/mt5/backend/${path}`, import.meta.url));
