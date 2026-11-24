import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseYaml,readProtocolPackage,writeYaml} from '../../protocol/package.mjs';

const hostRoot=process.env.SESAME_HOST_ROOT;
test('all locked packages reject stale surface bytes and the MCP schema service rejects malformed public calls',{skip:!hostRoot,timeout:180000},async t=>{
  const host=file=>import(pathToFileURL(join(hostRoot,file)));
  const {inspectPackage}=await host('modules/agent/plugin-system/package.js');
  const {validateSchemas,closeSchemaService}=await host('modules/shared/schema-service.js');
  t.after(closeSchemaService);
  const plugins=fileURLToPath(new URL('../../',import.meta.url));
  const counts={packages:0,staleSurfaces:0,knowledgeOnly:0,publicInputSchemas:0,hostOnlyHidden:0};
  for (const profile of ['api-v1','optional-api-v1']) {
    const source=join(plugins,profile);
    const locked=JSON.parse(readFileSync(join(source,'official-plugins.lock.json'))).packages;
    assert.ok(locked.length,profile);
    for (const item of locked) {
      const files=Object.fromEntries(item.files.map(file=>[file.path,readFileSync(join(source,'packages',item.directory,file.path))]));
      const entry=inspectPackage(files);
      const header=parseYaml(files['plugin.yaml']);
      const changed=Buffer.from(writeYaml({...header,description:header.description+' changed'}));
      assert.throws(()=>inspectPackage({...files,'plugin.yaml':changed}),/Surface lock mismatch/,item.id);
      counts.packages++;counts.staleSurfaces++;
      const visible=new Set(entry.protocolTools.map(tool=>tool.name));
      const declared=readProtocolPackage(files).capabilities.capabilities;
      assert.deepEqual([...visible].sort(),declared.filter(cap=>cap.consumers.includes('agent')).map(cap=>cap.id).sort(),item.id);
      for (const cap of declared) {
        if (!cap.consumers.includes('agent')) {
          assert.ok(!visible.has(cap.id),item.id+'#'+cap.id);
          counts.hostOnlyHidden++;
        }
      }
      if (!visible.size) counts.knowledgeOnly++;
      for(const tool of entry.protocolTools) {
        await assert.rejects(validateSchemas([{schema:tool.inputSchema,value:'invalid non-object arguments'}]),
          {code:'SCHEMA_MISMATCH'},item.id+'#'+tool.name);
        counts.publicInputSchemas++;
      }
    }
  }
  t.diagnostic(JSON.stringify(counts));
});
