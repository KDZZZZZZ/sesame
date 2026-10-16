import { fileURLToPath } from 'node:url';
export const mt5Import = path => import(new URL(`../../optional-api-v1/packages/mt5/backend/${path}`, import.meta.url));
export const mt5Path = path => fileURLToPath(new URL(`../../optional-api-v1/packages/mt5/backend/${path}`, import.meta.url));
