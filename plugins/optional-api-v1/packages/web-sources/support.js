import { randomUUID, createHash } from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${randomUUID()}`;
export const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export const requireValue = (condition, message, status = 422, code = 'invalid_request') => { if (!condition) throw new ApiError(status, code, message); };
