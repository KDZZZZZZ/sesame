import { capability } from '@sesame/plugin-sdk/capabilities';
import { createService } from './service.js';
import { closeRecords } from './records.js';
export function createCapabilities(host) { return [
 ...Object.entries({financial_research_status:'status',financial_research_configure:'configure',financial_research_query:'query',financial_research_read:'read'}).map(([name,method])=>capability(name,(input,signal)=>createService(host)[method](input,signal))),
 capability('research_evidence_query',({query,page})=>createService(host).queryEvidence(query,page)),
 capability('research_dispose',()=>{closeRecords(host);return{closed:true};})
 ]; }
