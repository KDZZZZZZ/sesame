"""Fixed public-only CCXT boundary. No API keys, private calls or orders."""
import sys,json,math,decimal,ccxt
from datetime import datetime

def norm(v):
 if isinstance(v,float):
  if not math.isfinite(v):raise ValueError('Nonfinite upstream number')
  return format(decimal.Decimal(str(v)),'f')
 if isinstance(v,list):return [norm(x) for x in v]
 if isinstance(v,dict):return {str(k):norm(x) for k,x in v.items()}
 return v
p=json.load(sys.stdin)
if p['exchange'] not in ['kraken','coinbase','okx']:raise ValueError('Unsupported explicit exchange')
settings={'enableRateLimit':True,'timeout':15000,'options':{'defaultType':'spot'}}
if p.get('publicProxy'):
 from urllib.parse import urlparse
 proxy=urlparse(p['publicProxy'])
 if proxy.scheme not in ['http','https'] or proxy.username or proxy.password:raise ValueError('Only explicit credential-free public proxy')
 settings['httpsProxy']=p['publicProxy']
exchange=getattr(ccxt,p['exchange'])(settings)
try:
 markets=exchange.load_markets()
 if p['action']=='markets':
  rows=[{k:m.get(k) for k in ['id','symbol','base','quote','active','spot','precision','limits']} for m in markets.values() if m.get('spot') and m.get('active') is not False]
 else:
  m=exchange.market(p['symbol'])
  if not m.get('spot') or m.get('active') is False:raise ValueError('Only active public spot markets')
  if p['action']=='bars':
   if p['timeframe'] not in ['1m','5m','15m','1h','1d'] or not exchange.has.get('fetchOHLCV') or p['timeframe'] not in exchange.timeframes:raise ValueError('Unsupported OHLCV timeframe')
   rows=exchange.fetch_ohlcv(p['symbol'],p['timeframe'],int(p['since']),500)
  elif p['action']=='ticker':
   rows=exchange.fetch_ticker(p['symbol'])
  else:raise ValueError('Unsupported fixed public operation')
 print(json.dumps({'rows':norm(rows),'library':ccxt.__version__,'exchange':exchange.id,'observedAt':int(datetime.now().timestamp()*1000)},allow_nan=False))
finally:
 close=getattr(exchange,'close',None)
 if close:close()
