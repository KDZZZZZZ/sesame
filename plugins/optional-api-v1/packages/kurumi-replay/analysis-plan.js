import { check, digest } from './replay-presentation.js';
// Evidence plan only: never installs/loads methods or requests a model.
export const CATALOG_DIGEST='sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2';
export const METHOD_RESEARCH_REF={"id": "artifact_58a3c5ef-03c5-4f4f-b18b-5f580f523749", "revision": "revision_76119709-4815-43de-8eb4-059eeb2819f5", "digest": "sha256:b6a7bc9757bb91e16a1da27cd7e5de3f12f8d249659562d957a5c12c48b62edc", "kind": "report", "schemaVersion": "1.0.0"};
export const PROPOSED_METHODS=Object.freeze([
  {
    "pluginId": "sesame/price-action",
    "version": "1.0.0",
    "digest": "sha256:4ff62adf910fb5cee8e02293ce518579162d585ef9917c9b8faf241f7ce1db2f",
    "method": "延迟确认摆动、首次收盘突破与趋势/区间证据卡",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "13e81a709c3b3736fdeb43b23ec925bc6219fd37",
      "path": "plugins/optional-api-v1/packages/price-action"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/dow-theory",
    "version": "1.0.0",
    "digest": "sha256:611ac358f12e678495c8ca0ff280dd24dfbb387ed7201d12fbb6e205d7338625",
    "method": "主要/次级趋势与独立序列收盘确认",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "13e81a709c3b3736fdeb43b23ec925bc6219fd37",
      "path": "plugins/optional-api-v1/packages/dow-theory"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/strategy-authoring",
    "version": "1.2.0",
    "digest": "sha256:aac7f8e3b5f49cec522dbf5088fb38fd9f7e90263e7b8021efdaeafaed91cbba",
    "method": "ATR、实现波动率与有证据的风险核对",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "22e07a4a78df17fa2c03180cb1f6d2c505f64c89",
      "path": "plugins/api-v1/packages/strategy-authoring"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/strategy-research",
    "version": "1.0.0",
    "digest": "sha256:3093c8eee5a73ef0b1b8b07c8f04b1b678c045b7d6b9bddc576926b49e1b430e",
    "method": "固定试验预算、时点防泄漏与负结果复盘",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "13e81a709c3b3736fdeb43b23ec925bc6219fd37",
      "path": "plugins/optional-api-v1/packages/strategy-research"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/backtrader",
    "version": "1.0.2",
    "digest": "sha256:a411c828164ca5755b60d515d725ceb8491a9c716c54d84ce61bf96860d39ada",
    "method": "固定数据、显式成本/滑点的原生 Cerebro 对照",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "13e81a709c3b3736fdeb43b23ec925bc6219fd37",
      "path": "plugins/optional-api-v1/packages/backtrader"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/behavioral-finance",
    "version": "1.0.0",
    "digest": "sha256:87e63f4aa7466703a8f97dafcd8ad70aec9b8577815280dff5747857cfccffca",
    "method": "有时点证据的参照点/注意力/预期偏差假设",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "13e81a709c3b3736fdeb43b23ec925bc6219fd37",
      "path": "plugins/optional-api-v1/packages/behavioral-finance"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  },
  {
    "pluginId": "sesame/reports",
    "version": "2.2.0",
    "digest": "sha256:5f5f51dddcc1d05a82b81adcb885a84eee8c36dad69811757674d7e45d7ef0d7",
    "method": "成本瀑布、逐笔分布与关联证据展示",
    "status": "proposed_not_adopted",
    "adopted": false,
    "normalPlayerInstallVerified": false,
    "source": {
      "repository": "https://github.com/KDZZZZZZ/sesame",
      "commit": "22e07a4a78df17fa2c03180cb1f6d2c505f64c89",
      "path": "plugins/api-v1/packages/reports"
    },
    "catalogDigest": "sha256:df6b1bd5ac567abf8bad02731d708d9656890122b1b2e598f16d6a02401815b2",
    "installationWorkflowId": "sesame-catalog-portable-methods-v1",
    "portability": {},
    "review": "catalog + pinned manifest/skill/source/dependency bytes; not installed behavior"
  }
]);
export const DISCOVERY_BASELINE=Object.freeze([
 {id:'sesame/strategy-authoring',version:'1.2.0',digest:'sha256:aac7f8e3b5f49cec522dbf5088fb38fd9f7e90263e7b8021efdaeafaed91cbba',state:'mounted',runtime_status:'ready',loaded:true,adoptedThisRound:false},
 {id:'sesame/backtrader',version:'1.0.2',digest:'sha256:a411c828164ca5755b60d515d725ceb8491a9c716c54d84ce61bf96860d39ada',state:'discoverable',runtime_status:'ready',loaded:false,adoptedThisRound:false},
 {id:'sesame/vnpy',version:'1.0.4',digest:'sha256:408b839b6d2e430e4589e6d8d21dba841c7a903a0c927ba04ce5d30f3152d385',state:'discoverable',runtime_status:'ready',loaded:false,adoptedThisRound:false}
]);
export function createAnalysisPlan(installed=[]){
 return {schemaVersion:'1.0.0',catalogDigest:CATALOG_DIGEST,queriedOnly:true,sourceResearchRef:METHOD_RESEARCH_REF,installationVerified:false,discoveryScope:'Caller-supplied actual discovery only; no preinstalled package assumed for new player',methods:PROPOSED_METHODS.map(p=>({...structuredClone(p),installed:installed.find(i=>i.id===p.pluginId)??null})),unusable:[{pluginId:'technical-analysis-theory',version:'0.1.0',runtime_status:'failed',diagnostic:'安装记录无效',adopted:false,action:'Do not activate or repair'}],boundaries:['只有后续验收授权才能安装/采用','没有真正执行的方法不得称已经采用','无前瞻已验证专属规则；同一历史重放不是样本外','绘图和周报不向交易角色传原作未来时点/结果','327早期CHFJPY缺口依然严格暂停；新run不能复用旧bound supplement'],appliedMethods:[]};
}
const ref=x=>check(x&&typeof x.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(x.digest??'')&&x.id&&x.kind&&x.schemaVersion==='1.0.0','Full fixed ArtifactRef required','METHOD_EVIDENCE_REQUIRED');
/** Adopt only after the main reviewer reads an actual immutable output and
 * execution receipt with matching plugin/method/version/input provenance.
 * Catalog/discovery/schema validation alone is intentionally insufficient. */
export async function verifyMethodUse(host,record,signal){
 signal?.throwIfAborted();check(record.pluginId!=='technical-analysis-theory','Failed method cannot be adopted','METHOD_UNAVAILABLE');
 check(record.version&&record.method&&record.executionReceipt?.status==='succeeded'&&record.executionReceipt.pluginId===record.pluginId&&record.executionReceipt.method===record.method&&record.executionReceipt.version===record.version,'Actual successful invocation receipt required','METHOD_EVIDENCE_REQUIRED');
 check(Number.isSafeInteger(record.asOfMs)&&Array.isArray(record.inputRefs)&&record.inputRefs.length,'Fixed inputs/cutoff required');record.inputRefs.forEach(ref);ref(record.outputRef);
 const output=await host.resources.read(record.outputRef,{part:'manifest'});check(output,'Output not readable','METHOD_EVIDENCE_REQUIRED');for(const input of record.inputRefs)check(await host.resources.read(input,{part:'manifest'}),'Input not readable','METHOD_EVIDENCE_REQUIRED');
 check(record.executionReceipt.outputDigest===record.outputRef.digest&&record.executionReceipt.inputDigest===digest(record.inputRefs),'Receipt/output/input mismatch','SOURCE_MISMATCH');
 return {...structuredClone(record),status:'adopted',adopted:true,verification:'public-receipt-and-artifact-read; not evidence of predictive validity'};
}
/** Role may receive general method/risk hypotheses ONLY. No original story,
 * first-run fills, historical profits or future event/calendar timestamps. */
export function generalMethodBrief(plan){return {sameHistoricalWindow:true,outOfSample:false,forwardValidatedRules:[],methods:plan.appliedMethods.filter(m=>m.status==='adopted').map(m=>({pluginId:m.pluginId,version:m.version,method:m.method,generalRiskHypotheses:m.generalRiskHypotheses??[]})),limitations:['Pretrained model may remember history','Candidate method/risk hypotheses are unverified']};}
