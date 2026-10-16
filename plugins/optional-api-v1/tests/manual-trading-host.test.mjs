/** Formal package installation + actual host composition, fictional backend only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.SESAME_HOST_ROOT;
test('formal portfolio execution package composes current-session tools and a receipt through the actual host without broker I/O',{skip:!root,timeout:60000},async()=>{
  const {Store}=await import(pathToFileURL(join(root,'modules/agent/store.js'))),{Runtime}=await import(pathToFileURL(join(root,'modules/agent/runtime.js'))),{createTools}=await import(pathToFileURL(join(root,'modules/agent/tools.js')));
  const directory=await mkdtemp(join(tmpdir(),'manual-trading-host-'));let store,runtime,sends=0,blockQuote=false,quoteStarted;
  try{
    store=new Store(join(directory,'app'));runtime=new Runtime(store,{piDir:join(directory,'pi'),officialPluginsDirectory:join(directory,'empty')});await runtime.init();
    const draft=join(runtime.workspaces.root('conv_main'),'execution-draft');await cp(fileURLToPath(new URL('../packages/portfolio-execution',import.meta.url)),draft,{recursive:true});
    const checked=await runtime.plugins.manager.test('conv_main',{path:draft});assert.equal(checked.passed,true,JSON.stringify(checked));
    const installed=await runtime.plugins.manager.install('conv_main',{path:draft,digest:checked.digest});assert.equal(installed.runtime_status,'ready');assert.equal(installed.id,'sesame/portfolio-execution');assert.equal(installed.version,'1.0.0');runtime.plugins.activate('conv_main',installed.id);
    const backendPlugin=JSON.parse(await readFile(new URL('../packages/mt5/plugin.json',import.meta.url)));
    const backendManifest=JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json',import.meta.url)));
    const names=['mt5_settings','mt5_catalog','mt5_python','mt5_trade','mt5_command'];
    const capabilities=names.map(name=>{const declaration=backendManifest.capabilities.find(capability=>capability.id===name);assert.ok(declaration,`Published capability missing: ${name}`);return declaration;});
    const definitions=capabilities.map(capability=>({name:capability.id,label:capability.id,description:capability.description,parameters:capability.inputSchema}));
    const commands=new Map();
    const fake=async(name,args,signal)=>{
      if(name==='mt5_settings')return {settings:{version:1,account:{login:'42',server:'Fixture-Demo'}}};
      if(name==='mt5_catalog')return {items:[{server:'python',tools:[{name:'order_send',callable:true,inputSchema:{properties:{execution_guard:{type:'object'}}}}]}]};
      if(name==='mt5_command')return commands.get(args.command_id);
      if(name==='mt5_trade'){
        sends++;assert.equal(args.tool,'order_send');assert.ok(args.arguments.execution_guard.expires_at>Date.now());
        const command={status:'returned',result:{result:{retcode:10009,order:'123'},execution_timing:{quote_to_send_ms:0,send_to_receipt_ms:1}}};commands.set(args.command_id,command);return command;
      }
      if(args.tool==='symbol_info_tick' && blockQuote){quoteStarted();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
      const values={account_info:{login:'42',server:'Fixture-Demo',trade_allowed:true,trade_expert:true},terminal_info:{connected:true},symbol_info:{name:'FIXTURE',volume_min:0.01,volume_max:1,volume_step:0.01,filling_mode:2,trade_exemode:2},positions_get:[],symbol_info_tick:{time_msc:Date.now(),bid:100,ask:101}};
      assert.ok(Object.hasOwn(values,args.tool));return {status:'returned',result:{result:values[args.tool]}};
    };
    runtime.plugins.register({id:'sesame/mt5',apiVersion:'2',version:backendPlugin.version,digest:`sha256:${'a'.repeat(64)}`,title:'FICTIONAL broker fixture',description:'No SDK or network',default_state:'mounted',agent_scope:'all',execution:'native',runtime_status:'ready',tool_names:names,
      main_tool_names:backendPlugin.main_tool_names.filter(name=>names.includes(name)),definitions,resources:[],skills:[],diagnostics:[],dependency_lock:[],
      capabilityManifest:{...backendManifest,capabilities,sources:[],services:[],hooks:[],views:[],knowledge:[],stateCollections:[],artifactSchemas:[]},
      module:Promise.resolve({createCapabilities:()=>capabilities.map(capability=>({name:capability.id,execute:(args,signal)=>fake(capability.id,args,signal)}))})});
    let sequence=0;
    const call=async(name,args,signal)=>{
      const tool=createTools(runtime,'conv_main').find(candidate=>candidate.name===name);assert.ok(tool);
      const result=await tool.execute(`fixture-${name}-${++sequence}`,args,signal);assert.ok(!result.isError,JSON.stringify(result));
      if(result.details.type!=='run')return result.details;
      const settled=await call('host_runs_wait',{runId:result.details.run.id,until:'settled',timeoutMs:30000},signal);
      assert.equal(settled.run.status,'completed',JSON.stringify(settled.run.error));return settled.run.output;
    };
    const observed=await call('manual_trade_observe',{backend:'mt5',symbol:'FIXTURE'});
    const args={operation_id:'host-once',observation_id:observed.observation_id,user_authorized:true,action:'market',side:'buy',quantity:'0.1',price_limit:'102'};
    const receipt=await call('manual_trade_execute',args);assert.equal(receipt.status,'execution_reported');assert.equal(sends,1);
    assert.deepEqual(await call('manual_trade_execute',args),receipt);assert.equal(sends,1);
    const child=runtime.createConversation('fixture research','No trading tools','conv_main');
    const childTool=createTools(runtime,child.id).find(x=>x.name==='manual_trade_execute');
    if(childTool)await assert.rejects(childTool.execute('child-attempt',args),{code:'plugin_unavailable'});
    assert.equal(sends,1);
    const audit=store.events(0).filter(e=>e.type==='capability_operation.updated');assert.ok(audit.length>=2);assert.doesNotMatch(JSON.stringify(audit),/Fixture-Demo|"quantity"|"price_limit"/);
    blockQuote=true;const ready=new Promise(resolve=>{quoteStarted=resolve;}),controller=new AbortController();
    const stopped=call('manual_trade_observe',{backend:'mt5',symbol:'FIXTURE'},controller.signal),rejected=assert.rejects(stopped,/fixture cancellation/);
    await ready;controller.abort(new Error('fixture cancellation'));await rejected;assert.equal(sends,1);assert.equal(runtime.plugins.calls.size,0);assert.equal(runtime.capabilities.pending.size,0);
  }finally{await runtime?.close();store?.close();await rm(directory,{recursive:true,force:true});}
});
