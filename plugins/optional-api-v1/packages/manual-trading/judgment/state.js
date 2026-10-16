const instances = new Map();
export const instance = host => { const value = instances.get(host.context.storageRoot); if (!value) throw new Error('Judgment plugin is not active'); return value; };
export const setInstance = (host, value) => value ? instances.set(host.context.storageRoot, value) : instances.delete(host.context.storageRoot);
