import { createService } from './service.js';
import { definitions } from './schema.js';

export function createTools(host) {
  const service = createService(host);
  return definitions(host.tools.Type).map(({ name, description, parameters, method }) =>
    host.tools.define(name, description, parameters, (args, signal) => service[method](args, signal)));
}
