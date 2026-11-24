import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha, assert } from './replay.mjs';

// References are human-owned files outside the candidate package. Missing
// predictions stay in the denominator. Edit neither set while evaluating.
export function calibration(references,predictions) {
  assert(Array.isArray(references)&&references.length>0 && Array.isArray(predictions),'Reference and prediction arrays required');
  const key=row=>{assert(typeof row.id==='string'&&row.id.length,'Observation ID required');return row.id;};
  const index=new Map(predictions.map(row=>[key(row),row]));
  assert(index.size===predictions.length && new Set(references.map(key)).size===references.length,'Duplicate observation ID');
  const measures=Object.fromEntries(['location','category','attribution','seedDetected','seedAttributed'].map(name=>[name,{hit:0,total:0}]));
  function tally(name,test) {const m=measures[name];m.total++;if(test)m.hit++;}
  for(const row of references) {
    assert(['human','seed'].includes(row.source) && ['location','category','attribution'].every(field=>typeof row[field]==='string'&&row[field].length),'A labelled location, category and attribution are required');
    const prediction=index.get(row.id);
    const detected=prediction?.detected===true;
    if(row.source==='human') for(const field of ['location','category','attribution']) tally(field,detected&&row[field]===prediction[field]);
    else {tally('seedDetected',detected);tally('seedAttributed',detected&&row.attribution===prediction.attribution);}
  }
  for(const measure of Object.values(measures)) {
    measure.rate=measure.total ? measure.hit/measure.total:null;
    measure.lowSample=measure.total<20;
  }
  return {references:sha(JSON.stringify(references)),predictions:sha(JSON.stringify(predictions)),measures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [reference,prediction]=process.argv.slice(2);
  if(!reference||!prediction) throw Error('Usage: calibrate.mjs <reference.json> <prediction.json>');
  console.log(JSON.stringify(calibration(...[reference,prediction].map(path=>JSON.parse(readFileSync(path)))),null,2));
}
