const services = new Map();
export function instance(host) {
  const service = services.get(host.context.storageRoot);
  if (!service) throw new Error('MT5 plugin has not activated');
  return service;
}
export function setInstance(host, service) { if (service) services.set(host.context.storageRoot, service); else services.delete(host.context.storageRoot); }
