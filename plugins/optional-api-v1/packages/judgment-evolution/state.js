const instances = new Map();
export const instance = host => { const value = instances.get(host.storage.directory); if (!value) throw new Error('Judgment plugin is not active'); return value; };
export const setInstance = (host, value) => value ? instances.set(host.storage.directory, value) : instances.delete(host.storage.directory);
