import test from 'node:test';
import assert from 'node:assert/strict';
import {createProtocolFiles,readProtocolHeader,readProtocolPackage,parseYaml,writeYaml,buildSurfaceLock} from '../../protocol/package.mjs';
import {readSurfaceFiles} from '../../protocol/directory.mjs';

const root = new URL('../../optional-api-v1/packages/auto-factor-mining/',import.meta.url);
const original = readSurfaceFiles(root);

test('real YAML, duplicate-key detection and an independent surface check', () => {
  const pkg=readProtocolPackage(original);
  assert.equal(readProtocolHeader(original['plugin.yaml']).manifest.id,pkg.manifest.id);
  assert.deepEqual(parseYaml('description: |\n  first\n  second\nitems: [a, b]\n'),{description:'first\nsecond\n',items:['a','b']});
  assert.throws(()=>parseYaml('name: first\nname: second\n'),/unique/i);
  assert.throws(()=>readProtocolPackage({...original,'plugin.json':'{}'}),/legacy/);
  assert.throws(()=>readProtocolPackage({...original,'instructions.md':'different policy'}),/lock mismatch/i);
  assert.equal(buildSurfaceLock({...original,'index.js':'function changed(){}'}).digest,pkg.surface.digest);
});

test('public Run schema, native terminal schema and host bindings have distinct projections', () => {
  const pkg=readProtocolPackage(original);
  const wire=pkg.tools.find(tool=>tool.name==='factor_evaluate'),native=pkg.capabilities.capabilities.find(cap=>cap.id===wire.name);
  assert.equal(wire.outputSchema.properties.type.const,'run');
  assert.equal(wire.annotations.readOnlyHint,false);
  assert.notDeepEqual(wire.outputSchema,native.outputSchema);
  assert.deepEqual(native.binding,{type:'native',name:'factor_evaluate'});
  const publicIds=new Set(pkg.tools.map(tool=>tool.name));
  assert.ok(pkg.capabilities.capabilities.some(cap=>!cap.consumers.includes('agent')));
  for (const cap of pkg.capabilities.capabilities) assert.equal(publicIds.has(cap.id),cap.consumers.includes('agent'));
});

test('catalog text is separate from the runtime contract and the optimization surface', () => {
  const current = readProtocolPackage(original), header = parseYaml(original['plugin.yaml']);
  assert.ok(current.catalog.title.zh);
  const changed = { ...current.catalog, title: { en: 'New title', zh: '新的展示标题' } };
  header['x-sesame'].catalog = changed;
  const files = { ...original, 'plugin.yaml': writeYaml(header) }, next = readProtocolPackage(files);
  assert.deepEqual(next.catalog, changed);
  assert.equal(Object.hasOwn(next.manifest, 'catalog'), false);
  assert.deepEqual(next.manifest, current.manifest);
  assert.deepEqual(readProtocolHeader(files['plugin.yaml']), readProtocolHeader(original['plugin.yaml']));
  assert.deepEqual(next.surface, current.surface);
});

test('reformatting YAML preserves surface identity while semantic changes identify the exact element', () => {
  const name='tools/factor_evaluate.yaml',source=parseYaml(original[name]),id='sesame/auto-factor-mining:tool/factor_evaluate.description';
  const before=buildSurfaceLock(original);
  const recoded={...original,[name]:JSON.stringify(source,null,2)};
  assert.deepEqual(buildSurfaceLock(recoded),before);
  source.description+=' More detail.';
  const after=buildSurfaceLock({...original,[name]:writeYaml(source)});
  assert.notEqual(after.digest,before.digest);
  assert.deepEqual(Object.keys(after.elements).filter(key=>before.elements[key]!==after.elements[key]),[id]);
});

test('authoring emits an immediately verifiable knowledge-only package', () => {
  const files=createProtocolFiles({id:'example/guide',version:'1.0.0',title:'Guide',description:'A method',skills:['skills']},
    {capabilities:[]},{'skills/guide/SKILL.md':'---\nname: guide\ndescription: A method\n---\n\n# Inspect observations\n','skills/guide/data.csv':'x,y\n1,2\n'});
  const pkg=readProtocolPackage(files);
  assert.deepEqual(pkg.tools,[]);
  assert.ok(Object.hasOwn(pkg.surface.elements,'example/guide:skill/guide.file/data.csv'));
  assert.throws(()=>readProtocolHeader(writeYaml({...parseYaml(files['plugin.yaml']),id:'../unsafe'})),/Invalid/);
});
