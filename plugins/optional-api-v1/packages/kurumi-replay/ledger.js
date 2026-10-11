// Pure exact ledger audit, shared by reporting and recovery reconciliation.
const assert=(ok,message,code='INVALID_ARGUMENT')=>{if(!ok)throw Object.assign(new Error(message),{code});};
// Exact arbitrary-scale decimal sums; ratios deliberately truncated at 8 dp.
function d(v) { assert(typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v),'账本金额不是Decimal'); const [a,b='']=v.split('.'); return {n:BigInt(a+b),s:b.length}; }
function t({n,s}) { const neg=n<0n;let a=(neg?-n:n).toString().padStart(s+1,'0');if(s)a=a.slice(0,-s)+'.'+a.slice(-s);return (neg?'-':'')+a.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''); }
function op(a,b,subtract=false) { const x=d(a),y=d(b),s=Math.max(x.s,y.s);return t({n:x.n*10n**BigInt(s-x.s)+(subtract?-1n:1n)*y.n*10n**BigInt(s-y.s),s}); }
function cmp(a,b) { const n=d(op(a,b,true)).n;return n<0n?-1:n>0n?1:0; }
function ratio(a,b,mult=1n) {const x=d(a),y=d(b);assert(y.n!==0n,'除数零');return t({n:x.n*10n**BigInt(y.s+8)*mult/(y.n*10n**BigInt(x.s)),s:8});}
export function auditLedger(state) {
  let balance='300000',commission='0',financing='0',realized='0';
  for(const row of state.ledger) {
    realized=op(realized,row.realizedJpy);commission=op(commission,row.commission);financing=op(financing,row.financing);
    balance=op(op(op(balance,row.realizedJpy),row.commission,true),row.financing,true);
    assert(cmp(balance,row.balanceAfter)===0,`账本逐行不一致：${row.id}`,'LEDGER_MISMATCH');
  }
  assert(cmp(balance,state.balance)===0,'最终余额不能由成交/费用账本对上','LEDGER_MISMATCH');
  let peak='300000',maxDrawdown='0';
  for(const row of state.equity) { if(cmp(row.equity,peak)>0)peak=row.equity; const draw=ratio(op(peak,row.equity,true),peak,100n);if(cmp(draw,maxDrawdown)>0)maxDrawdown=draw; }
  return {balance,realized,commission,financing,maxDrawdownPct:maxDrawdown,netProfit:op(balance,'300000',true),settledFactor:ratio(balance,'300000'),externalFunding:'0',targetFactor:ratio('20000000','300000')};
}
