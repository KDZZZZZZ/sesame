import { runWorker } from './worker-call.js';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { sourceCapabilities } from './source.js';

export function createCapabilities(host) {
    const run = (operation, args, signal, timeoutMs = 120000) => runWorker(host, { operation, ...args }, { signal, timeoutMs });
    return [
...sourceCapabilities(host),
capability('akshare_discover', (args,signal)=>run('discover',{pythonPath:args.python_path},signal)),
        capability('akshare_status', (args, signal) => run('status', args, signal)),
        capability('akshare_prepare', (args, signal) => run('prepare', { pythonPath: args.python_path }, signal, 600000)),
        capability('akshare_catalog', () => ({ interfaces: [{name:'stock_bid_ask_em',arguments:{symbol:'6 digit A-share code'},source:'Eastmoney point-in-time bid/ask snapshot; observation time only'},{name:'stock_zh_a_spot_tx',arguments:{},source:'Tencent point-in-time all-market snapshot; observation time only'},{name:'stock_zh_a_hist_tx',arguments:{symbol:'sh/sz/bj+code',start_date:'YYYYMMDD',end_date:'YYYYMMDD',adjust:'|qfq|hfq'},source:'Tencent',volumeUnit:'share'},{ name: 'stock_info_a_code_name', arguments: {}, source: 'AKShare combined exchange catalog' }, { name: 'stock_zh_a_spot_em', arguments: {}, source: 'Eastmoney point-in-time catalog/spot snapshot; not streaming' }, { name: 'stock_zh_a_hist', arguments: { symbol: '6 digit A-share code', period: 'daily', start_date: 'YYYYMMDD', end_date: 'YYYYMMDD', adjust: '|qfq|hfq' }, source: 'Eastmoney', volumeUnit: 'lot (100 shares)' }, { name: 'stock_zh_a_daily', arguments: { symbol: 'sh/sz + 6 digits', start_date: 'YYYYMMDD', end_date: 'YYYYMMDD', adjust: '|qfq|hfq' }, source: 'Sina', volumeUnit: 'share' }], streaming: false, subscriptions: ['60-second quote snapshot polling (observation time only)','60-second real daily-history polling'], provider: { pluginId: 'sesame/akshare', providerId: 'market' }, connections: [{ id: 'akshare:eastmoney', revision: '1.19.1' }, { id: 'akshare:sina', revision: '1.19.1' },{id:'akshare:tencent',revision:'1.19.1'}], documentation: 'https://akshare.akfamily.xyz/data/stock/stock.html' })),
        capability('akshare_quote', async(args,signal)=>{const tx=args.source==='tencent';const result=await run('query',{interface:tx?'stock_zh_a_spot_tx':'stock_bid_ask_em',arguments:tx?{}:{symbol:args.symbol}},signal);return{...result,rows:tx?result.rows.filter(r=>String(r.code).replace(/^(sh|sz|bj)/,'')===args.symbol):result.rows,source:args.source??'eastmoney',exchangeTimeAvailable:false}}),
        capability('akshare_query', async (args, signal) => { const result = await run('query', { interface: args.interface, arguments: args.arguments }, signal); return { ...result, rows: result.rows.slice(0, args.max_rows ?? 100), totalRows: result.rows.length, truncated: result.rows.length > (args.max_rows ?? 100) }; }),
    ];
}
