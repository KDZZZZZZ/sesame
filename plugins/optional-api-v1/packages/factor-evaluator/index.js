import definitions from './tools.json' with { type: 'json' };
import { evaluate } from './evaluator.js';
export function createTools(host) {
  const { define, Type } = host.tools;
  return definitions.map(spec => define(spec.name, spec.description, Object.fromEntries(Object.entries(spec.parameters.properties).map(([key, schema]) =>
    [key, spec.parameters.required?.includes(key) ? schema : Type.Optional(schema)])), args => evaluate(host, args)));
}
