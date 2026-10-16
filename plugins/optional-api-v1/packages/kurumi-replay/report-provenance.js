const kinds=new Set(['observed','derived','user_input','demo']);
function requireKind(kind){
  if(!kinds.has(kind))throw Object.assign(new Error('Frozen source classification required; do not infer missing provenance from a later service'),{code:'PROVENANCE_REQUIRED'});
  return kind;
}

// Capture classification only. Prepared data can also contain undisclosed
// chapters/story anchors; those must not enter the frozen weekly input.
export function freezeSourceClassification(provenance){
  const result={kind:requireKind(provenance?.kind)};
  if(provenance.inputKind!==undefined)result.inputKind=requireKind(provenance.inputKind);
  return result;
}

export function weeklyProvenanceKind(input){
  const sources=[input.opening,input.closing].map(frame=>freezeSourceClassification(frame.sourceProvenance));
  return sources.some(p=>p.kind==='demo'||p.inputKind==='demo')?'demo':'derived';
}

// A source resource retains frozen file hashes/URLs even when the provider has
// no ArtifactRef. Only actual public artifact references become dependencies.
export function weeklySourceEvidence(input){
  return Object.fromEntries(['opening','closing'].map(key=>{
    const frame=input[key];
    return [key,structuredClone({runId:frame.runId,chapter:frame.chapter,cutoffMs:frame.cutoffMs,
      classification:freezeSourceClassification(frame.sourceProvenance),
      sources:frame.market.sources,digests:frame.sourceDigests,coverage:frame.sourceCoverage,methods:frame.methods})];
  }));
}

export function weeklySourceReferences(input){
  const refs=new Map();
  function collect(value){
    if(!value||typeof value!=='object')return;
    if(typeof value.id==='string'&&typeof value.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(value.digest)
      &&typeof value.kind==='string'&&value.schemaVersion==='1.0.0'){
      const ref={id:value.id,revision:value.revision,digest:value.digest,kind:value.kind,schemaVersion:value.schemaVersion};
      refs.set(JSON.stringify(ref),ref);return;
    }
    for(const nested of Object.values(value))collect(nested);
  }
  for(const frame of [input.opening,input.closing]){
    collect(frame.market.sources);
    for(const method of frame.methods??[])if(method.status==='adopted'){collect(method.inputRefs);collect(method.outputRef);}
  }
  return [...refs.values()];
}
