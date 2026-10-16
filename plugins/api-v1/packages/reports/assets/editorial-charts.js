/* Sesame editorial charts 1.0.1 — MIT, Sesame contributors.
 * Original implementation. No third-party chart runtime or network dependency. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const fail = message => { throw new Error(`SesameCharts: ${message}`); };
  const node = (name, attrs = {}, text) => {
    const n = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    if (text !== undefined) n.textContent = String(text);
    return n;
  };
  const html = (name, className, text) => { const n = document.createElement(name); if (className) n.className = className; if (text !== undefined) n.textContent = String(text); return n; };
  const numeric = value => value === null || value === undefined || value === '' ? null : (typeof value === 'number' || typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) ? Number(value) : fail(`invalid numeric value ${String(value).slice(0,60)}`);
  const scale = (domain, range) => { const [a,b] = domain, [x,y] = range; return value => x + (value-a)/(b-a || 1)*(y-x); };
  const extent = values => { if (!values.length) return [0,1]; const min=Math.min(...values),max=Math.max(...values); return min===max?[min===0?0:min-Math.abs(min)*.05,max===0?1:max+Math.abs(max)*.05]:[min,max]; };
  const format = (value, unit = '') => value === null || value === undefined ? '—' : `${new Intl.NumberFormat(document.documentElement.lang || 'en',{maximumFractionDigits:3}).format(value)}${unit ? ` ${unit}` : ''}`;
  const exactUnits=(value,unit)=>{
    const parts=value=>{const match=String(value).match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!match)fail('invalid unit count');return {coefficient:BigInt((match[1]||'')+match[2]+(match[3]||'')),scale:(match[3]||'').length-Number(match[4]||0)};};
    const a=parts(value),b=parts(unit),scale=Math.max(a.scale,b.scale),numerator=a.coefficient*10n**BigInt(scale-a.scale),denominator=b.coefficient*10n**BigInt(scale-b.scale);
    if(numerator<0n||denominator<=0n||numerator%denominator!==0n)fail('unit charts require nonnegative whole multiples of unitValue');
    const count=numerator/denominator;if(count>1000n)fail('unit chart exceeds 1,000 units; choose and label a larger exact unitValue');return Number(count);
  };
  const observers = new WeakMap();
  function chart(target, spec) {
    if (typeof target === 'string') target=document.querySelector(target);
    if (!target || !Array.isArray(spec.rows)) fail('target and rows are required');
    if (spec.rows.length>2500) fail('more than 2,500 marks; aggregate or filter the fixed data first');
    if (!['line','bar','scatter','matrix','units'].includes(spec.kind)) fail('unknown chart kind');
    observers.get(target)?.disconnect();
    const state={observer:null,pendingFrame:null,svg:null,measured:0};
    state.disconnect=()=>{state.observer?.disconnect();if(state.pendingFrame!==null){global.cancelAnimationFrame(state.pendingFrame);state.pendingFrame=null;}};
    state.handle={get svg(){return state.svg;},destroy:()=>{if(observers.get(target)!==state)return;state.disconnect();observers.delete(target);target.replaceChildren();}};
    observers.set(target,state);
    try{return drawChart(target,spec,state);}catch(error){state.disconnect();observers.delete(target);throw error;}
  }
  function drawChart(target,spec,state){
    const measured=target.clientWidth,rows=spec.rows,width=Math.max(280,measured || 760),height=spec.height || Math.min(320,Math.max(240,width*.4)),pad={left:65,right:24,top:25,bottom:52};
    const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':spec.title || spec.kind}),frame=html('div','sc-frame'),tooltip=html('div','sc-tooltip');
    tooltip.setAttribute('role','status');tooltip.hidden=true;frame.append(svg,tooltip);target.replaceChildren(frame);
    const complete=()=>{
      state.svg=svg;state.measured=measured;
      if(state.observer)return state.handle;
      state.observer=new ResizeObserver(()=>{
        // ResizeObserver delivery must not synchronously change layout. Height
        // changes and hidden views do not require a new chart; a later positive
        // width notification will render a view that was created while hidden.
        if(observers.get(target)!==state||state.pendingFrame!==null||target.clientWidth<=0||Math.abs(target.clientWidth-state.measured)<=2)return;
        state.pendingFrame=global.requestAnimationFrame(()=>{
          state.pendingFrame=null;
          if(observers.get(target)===state&&target.clientWidth>0&&Math.abs(target.clientWidth-state.measured)>2)drawChart(target,spec,state);
        });
      });
      state.observer.observe(target);
      return state.handle;
    };
    if (!rows.length){svg.append(node('text',{x:width/2,y:height/2,'text-anchor':'middle',class:'sc-label'},spec.emptyLabel || 'No observations'));return complete();}
    const missing=rows.filter(r=>numeric(r[spec.value || spec.y])===null||(spec.kind==='scatter'&&numeric(r[spec.x])===null)).length;
    const label = row => `${row[spec.x] ?? row[spec.label] ?? ''}${spec.kind==='matrix'?` / ${row[spec.y]}`:''}: ${row[spec.value || spec.y] ?? 'missing'}${spec.unit ? ` ${spec.unit}` : ''}`;
    const mark=(n,row,index)=>{
      const title=node('title',{},label(row));n.append(title);n.setAttribute('tabindex','0');n.setAttribute('role','button');n.setAttribute('aria-label',label(row));n.setAttribute('data-row-index',index);
      const show=()=>{tooltip.textContent=label(row);tooltip.hidden=false;};
      const select=()=>{svg.querySelectorAll('.sc-selected').forEach(el=>el.classList.remove('sc-selected'));n.classList.add('sc-selected');show();target.dispatchEvent(new CustomEvent('chartselect',{bubbles:true,detail:{row,index}}));spec.onSelect?.(row,index);};
      n.addEventListener('pointerenter',show);n.addEventListener('focus',show);n.addEventListener('pointerleave',()=>{if(document.activeElement!==n)tooltip.hidden=true;});n.addEventListener('blur',()=>tooltip.hidden=true);n.addEventListener('click',select);n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});svg.append(n);return n;
    };
    function yAxis(domain) {
      const sy=scale(domain,[height-pad.bottom,pad.top]);
      for(let i=0;i<=4;i++){const value=domain[0]+(domain[1]-domain[0])*i/4,y=sy(value);svg.append(node('line',{x1:pad.left,x2:width-pad.right,y1:y,y2:y,class:'sc-grid'}),node('text',{x:pad.left-10,y:y+4,'text-anchor':'end',class:'sc-axis'},format(value)));}
      if(spec.unit)svg.append(node('text',{x:pad.left,y:12,class:'sc-axis'},spec.unit));
      return sy;
    }
    function categories(values) {
      const sx=scale([0,Math.max(values.length-1,1)],[pad.left,width-pad.right]);
      const stride=Math.max(1,Math.ceil(values.length/Math.max(2,Math.floor((width-pad.left-pad.right)/70))));values.forEach((value,i)=>{if((i%stride===0&&(i===0||sx(values.length-1)-sx(i)>=65))||i===values.length-1)svg.append(node('text',{x:sx(i),y:height-16,'text-anchor':i===0?'start':i===values.length-1?'end':'middle',class:'sc-axis'},String(value).slice(0,24)));});return sx;
    }
    if(spec.kind==='line'){
      const ys=rows.map(r=>numeric(r[spec.y])),domain=extent(ys.filter(v=>v!==null)),sy=yAxis(domain),sx=categories(rows.map(r=>r[spec.x]));
      let path='',drawing=false;ys.forEach((y,i)=>{if(y===null){drawing=false;return;}path+=`${drawing?'L':'M'}${sx(i)},${sy(y)} `;drawing=true;});svg.append(node('path',{d:path,fill:'none',class:'sc-line'}));
      ys.forEach((y,i)=>{if(y!==null)mark(node('circle',{cx:sx(i),cy:sy(y),r:3.5,class:'sc-point'}),rows[i],i);});
    } else if(spec.kind==='bar'){
      const ys=rows.map(r=>numeric(r[spec.y])),domain=extent([0,...ys.filter(v=>v!==null)]),sy=yAxis(domain),band=(width-pad.left-pad.right)/rows.length;
      rows.forEach((row,i)=>{const y=ys[i];if(y===null)return;mark(node('rect',{x:pad.left+i*band+band*.18,y:Math.min(sy(y),sy(0)),width:band*.64,height:Math.max(.6,Math.abs(sy(y)-sy(0))),rx:2,class:y<0?'sc-negative':'sc-bar'}),row,i);if(rows.length<=12)svg.append(node('text',{x:pad.left+(i+.5)*band,y:height-16,'text-anchor':'middle',class:'sc-axis'},String(row[spec.x]).slice(0,16)));});
      svg.append(node('line',{x1:pad.left,x2:width-pad.right,y1:sy(0),y2:sy(0),class:'sc-zero'}));
    } else if(spec.kind==='scatter'){
      const points=rows.map((r,i)=>({r,i,x:numeric(r[spec.x]),y:numeric(r[spec.y])})).filter(p=>p.x!==null&&p.y!==null),xd=extent(points.map(p=>p.x)),yd=extent(points.map(p=>p.y)),sx=scale(xd,[pad.left,width-pad.right]),sy=yAxis(yd);
      for(let i=0;i<=4;i++){const v=xd[0]+(xd[1]-xd[0])*i/4;svg.append(node('text',{x:sx(v),y:height-16,'text-anchor':'middle',class:'sc-axis'},format(v)));}
      points.forEach(p=>mark(node('circle',{cx:sx(p.x),cy:sy(p.y),r:5,class:'sc-point'}),p.r,p.i));
    } else if(spec.kind==='matrix'){
      const xs=[...new Set(rows.map(r=>String(r[spec.x])))],ys=[...new Set(rows.map(r=>String(r[spec.y])))];
      if(xs.length>20||ys.length>20)fail('matrix is limited to 20 × 20 categories');
      if(rows.length!==xs.length*ys.length)fail('matrix requires an explicit row for every cell; use null for missing observations');
      const values=rows.map(r=>numeric(r[spec.value])),max=Math.max(1,...values.filter(v=>v!==null).map(Math.abs)),w=(width-pad.left-pad.right)/xs.length,h=(height-pad.top-pad.bottom)/ys.length,seen=new Set();
      rows.forEach((row,i)=>{const x=xs.indexOf(String(row[spec.x])),y=ys.indexOf(String(row[spec.y])),key=JSON.stringify([x,y]);if(seen.has(key))fail('duplicate matrix cell; aggregate explicitly');seen.add(key);const v=values[i];const r=node('rect',{x:pad.left+x*w+2,y:pad.top+y*h+2,width:Math.max(1,w-4),height:Math.max(1,h-4),rx:2,class:v===null?'sc-missing':v<0?'sc-negative':'sc-bar',opacity:v===null?1:.2+.8*Math.abs(v)/max});mark(r,row,i);if(w>45&&h>25)svg.append(node('text',{x:pad.left+(x+.5)*w,y:pad.top+(y+.5)*h+4,'text-anchor':'middle',class:`sc-cell-value${v!==null&&.2+.8*Math.abs(v)/max>.65?' sc-cell-inverse':''}`},v===null?'—':format(v)));});
      xs.forEach((x,i)=>svg.append(node('text',{x:pad.left+(i+.5)*w,y:height-16,'text-anchor':'middle',class:'sc-axis'},x.slice(0,14))));ys.forEach((y,i)=>svg.append(node('text',{x:pad.left-8,y:pad.top+(i+.5)*h+4,'text-anchor':'end',class:'sc-axis'},y.slice(0,10))));
    } else if(spec.kind==='units'){
      const unit=spec.unitValue ?? 1; if(!Number.isFinite(unit)||unit<=0)fail('unitValue must be positive');
      const counts=rows.map(row=>numeric(row[spec.y])===null?0:exactUnits(row[spec.y],unit));
      if(counts.reduce((a,b)=>a+b,0)>1000)fail('unit chart exceeds 1,000 units; choose and label a larger exact unitValue');
      const across=Math.max(1,Math.floor((width-pad.left-pad.right)/16));
      let offset=0;rows.forEach((row,i)=>{for(let n=0;n<counts[i];n++){const k=offset++,x=pad.left+(k%across)*16,y=pad.top+Math.floor(k/across)*16;mark(node('circle',{cx:x,cy:y,r:4,class:i%2?'sc-unit-alt':'sc-point'}),row,i);}});
      svg.setAttribute('viewBox',`0 0 ${width} ${Math.max(85,pad.top+Math.ceil(offset/across)*16+55)}`);svg.append(node('text',{x:pad.left,y:Math.max(65,pad.top+Math.ceil(offset/across)*16+28),class:'sc-axis'},`1 dot = ${unit} ${spec.unit || 'observations'}`));
    }
    if(missing){const note=html('p','sc-missing-note',`${missing} ${spec.missingLabel || 'missing values; never replaced with zero'}`);frame.append(note);}
    return complete();
  }
  function table(target,rows,columns,{limit=100}={}){
    if(typeof target==='string')target=document.querySelector(target);const wrap=html('div','sc-table-wrap'),t=html('table','sc-table'),head=html('thead'),tr=html('tr');
    for(const c of columns)tr.append(html('th',null,typeof c==='string'?c:c.title));head.append(tr);t.append(head);const body=html('tbody');
    rows.slice(0,limit).forEach((row,i)=>{const tr=html('tr');tr.dataset.rowIndex=i;for(const c of columns){const key=typeof c==='string'?c:c.key;tr.append(html('td',null,row[key]===null||row[key]===undefined?'—':row[key]));}body.append(tr);});t.append(body);wrap.append(t);target.replaceChildren(wrap);
    if(rows.length>limit)target.append(html('p','sc-missing-note',`${limit} / ${rows.length} rows shown. Filter to inspect more.`));
    return {select:index=>{body.querySelectorAll('tr').forEach((row,i)=>row.classList.toggle('sc-row-selected',i===index));},destroy:()=>target.replaceChildren()};
  }
  async function readRows(dataId,{maxRows=50000,limit=1000}={}){
    if(!global.report || typeof global.report.readData!=='function')fail('the report/1 read-only data bridge is unavailable');
    let cursor,rows=[];const seen=new Set();
    do{const result=await global.report.readData(dataId,{...(cursor?{cursor}:{}),limit});if(!Array.isArray(result.rows))fail('invalid data page');rows.push(...result.rows);if(rows.length>maxRows)fail('data exceeds the declared row budget; filter or aggregate before publishing');cursor=result.page?.nextCursor;if(cursor){if(seen.has(cursor))fail('repeated page cursor');seen.add(cursor);}}while(cursor);
    return rows;
  }
  Object.defineProperty(global,'SesameCharts',{value:Object.freeze({version:'1.0.1',chart,table,readRows,format,numeric}),configurable:false});
})(window);
