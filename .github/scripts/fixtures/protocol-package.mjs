import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createProtocolFiles } from '../../../plugins/protocol/directory.mjs';

export function writeFixturePackage(directory, manifest, declaration) {
  const capabilities = declaration.capabilities.map(capability => ({ description: capability.id, ...capability }));
  const files = createProtocolFiles({ title: 'Example', description: 'Fixture package', ...manifest },
    { ...declaration, capabilities }, { 'evals/cases/example.yaml': 'id: example\n' });
  for (const [name, data] of Object.entries(files)) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
}
