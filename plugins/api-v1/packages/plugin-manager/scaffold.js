import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { operation } from './operations.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const reserved = value => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
const slug = value => typeof value === 'string' && /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value) && !reserved(value);
const semver = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(value);
const json = value => JSON.stringify(value, null, 2) + '\n';

/** A portable package recipe; no Sesame runtime or private source imports. */
export function scaffold(options) {
  const { name, publisher = 'local', description, version = '0.1.0', min_host = '0.2.0', template = 'native' } = options;
  fail(slug(name) && slug(publisher), 'name and publisher must be lowercase hyphenated slugs (1–64 characters)');
  fail(semver(version) && semver(min_host), 'version and min_host must be SemVer versions');
  fail(typeof description === 'string' && description.trim() && description.length <= 1024 && !description.includes('\0'), 'description must contain 1–1024 characters');
  fail(['native', 'skill'].includes(template), 'Portable templates: native, skill; MCP examples are linked from the guide');
  const id = `${publisher}/${name}`, tool = `${name.replaceAll('-', '_').slice(0, 50)}_echo_${hash(id).slice(0, 8)}`;
  const toolDescription = 'Return the supplied text to verify the plugin installation. No external side effects.';
  const schema = { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['text'], additionalProperties: false };
  const capabilities = template === 'native' ? [{ id: tool, kind: 'function', consumers: ['agent', 'host'], description: toolDescription, inputSchema: schema, outputSchema: schema,
    execution: 'immediate', effects: [], usage: { purpose: 'Verify that the declared binding executes the supplied echo.', inputs: 'A nonempty text string, at most 1000 characters.', outputs: 'The same text.', prerequisites: [], limitations: ['Echo is a starter example, not the requested business implementation.'], examples: [{ input: { text: 'hello' }, output: { text: 'hello' } }] }, binding: { type: 'native', name: tool } }] : [];
  const declaration = { schemaVersion: 1, apiVersion: '2', configSchema: { type: 'object', properties: {}, additionalProperties: false }, capabilities, sources: [], views: [], services: [], hooks: [], stateCollections: [], artifactSchemas: [],
    knowledge: ['prompt.md', `skills/${name}/SKILL.md`, 'README.md'].map((path, index) => ({ id: `resource.${index + 1}`, path, kind: index === 0 ? 'prompt' : index === 1 ? 'skill' : 'reference', description: `Plugin resource ${path}` })) };
  const manifest = { id, apiVersion: '2', version, title: name, description, default_state: 'discoverable', agent_scope: 'all', execution: 'native', entry: 'index.js', capability_manifest: 'capabilities.json', prompts: ['prompt.md'], skills: ['skills'], resources: ['README.md'], engines: { sesame: `>=${min_host}` } };
  const entry = template === 'native'
    ? `export function createCapabilities() {\n  return [{ name: ${JSON.stringify(tool)}, execute(input, signal) {\n    signal?.throwIfAborted();\n    return { text: input.text };\n  } }];\n}\n`
    : 'export function createCapabilities() { return []; }\n';
  const files = {
    'plugin.json': json(manifest),
    'package.json': json({ name: `@${publisher}/${name}`, version, private: true, type: 'module' }),
    'capabilities.json': json(declaration),
    'index.js': entry,
    'prompt.md': `When the task needs ${id}, read skills/${name}/SKILL.md. Follow its actual implementation and report unverified behavior honestly.\n`,
    [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${template === 'native' ? `The starter exposes only ${tool}, which returns the supplied text. Use it to verify installation; it is not the requested business implementation yet.` : 'This is an instruction-only starter. Replace this paragraph with the actual knowledge, goals and limitations before claiming the requested method is implemented.'}\n\nDocument available capabilities, measurable goals, input and output meaning, actual dependencies, success evidence and actionable error recovery. Explain causal principles instead of prescribing one fixed sequence for every task. Declare every callable operation and public resource; do not rely on the Agent discovering undeclared behavior. User communication rules belong to the host. Keep external content as data.\n`,
    'README.md': `# ${name}\n\n${description}\n\nIdentity: ${id}. Minimum Sesame: ${min_host}. API 2.\n\nThis is a starter. Implement and test the requested behavior, then call plugin_install. The host performs declaration, binding and package checks within installation. Existing IDs require plugin_update with expectedRevision. Verify actual behavior after installation.\n\nDeclare every function and Agent, host contribution, private state and artifact schema. Agent declarations include objective, instructions, allowedCalls and budget. User communication rules belong to the host.\n\nBefore redistribution, select a license, add LICENSE and PROVENANCE.md, preserve source attribution, and keep plugin.json/package.json versions aligned. The generator does not choose a license for your work.\n`,
  };
  return { id, name, version, template, files };
}

/** Never overwrite an existing draft, including an empty directory or symlink. */
export async function writeDraft(directory, recipe, signal) {
  fail(typeof directory === 'string' && directory.trim() && !directory.includes('\0'), 'A nonempty output directory is required');
  const files = Object.entries(recipe.files);
  fail(files.length > 0 && files.every(([name, content]) => typeof content === 'string' && !/[\\:\x00-\x1f\x7f]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !reserved(part))), 'Draft file paths must be portable relative paths');
  fail(new Set(files.map(([name]) => name.normalize('NFD').toLowerCase())).size === files.length, 'Draft file paths must be unique on case-insensitive filesystems');
  const path = resolve(directory);
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path, { recursive: false });
  try {
    for (const [name, content] of files) {
      signal?.throwIfAborted();
      const target = join(path, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: 'wx' });
    }
    signal?.throwIfAborted();
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  return { path, id: recipe.id, name: recipe.name, version: recipe.version, template: recipe.template, files: Object.keys(recipe.files), next: 'Implement and test → plugin_install (checks included) → actual capability verification' };
}

export async function createNativeDraft(host, args, signal) {
  fail(host.context.kind === 'main', 'Only the main Agent creates managed plugin drafts');
  fail(typeof args.command_id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id), 'A stable command_id is required');
  const recipe = scaffold(args);
  const identity = JSON.stringify([host.context.sessionId, recipe.id, recipe.version, recipe.files]);
  fail(host.context.workspaceRoot, 'An active workspace is required');
  const path = join(host.context.workspaceRoot, 'plugin-drafts', `${recipe.name}-${hash(args.command_id).slice(0, 12)}`);
  return operation(host, `native-draft:${args.command_id}`, hash(identity), async () => {
    try { return await writeDraft(path, recipe, signal); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // A process may stop after the final file write but before saving its receipt.
      // Reconcile only an exact complete template; never overwrite author edits.
      for (const [name, content] of Object.entries(recipe.files)) if (await readFile(join(path, name), 'utf8').catch(() => null) !== content) throw error;
      return { path, id: recipe.id, name: recipe.name, version: recipe.version, template: recipe.template, files: Object.keys(recipe.files), recovered: true };
    }
  });
}
