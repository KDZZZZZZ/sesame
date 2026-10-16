"""Read-only whitelist. No arbitrary code evaluation or account/trade interfaces."""
import sys,json,decimal,datetime,math,re

def value(v):
    if v is None: return None
    if isinstance(v,(datetime.date,datetime.datetime)): return v.isoformat()
    if isinstance(v,(str,bool)): return v
    if isinstance(v,(int,float)) or hasattr(v,'item'):
        if hasattr(v,'item'): v=v.item()
        if isinstance(v,float) and not math.isfinite(v): return None
        return format(decimal.Decimal(str(v)),'f')
    return str(v)

def query(payload):
    import akshare as ak
    import requests
    original=requests.sessions.Session.request
    def bounded(self,method,url,**kwargs):
        kwargs['timeout']=min(kwargs.get('timeout') or 20,20)
        return original(self,method,url,**kwargs)
    requests.sessions.Session.request=bounded
    name=payload['interface']; args=payload.get('arguments',{})
    if name in ('stock_info_a_code_name','stock_zh_a_spot_em','stock_zh_a_spot_tx'):
        if args: raise ValueError('No arguments allowed for stock_info_a_code_name')
    elif name=='stock_bid_ask_em':
        if set(args)!={'symbol'} or not re.fullmatch(r'\d{6}',args.get('symbol','')): raise ValueError('Quote requires one six-digit A-share symbol')
    elif name=='stock_zh_a_hist':
        if set(args)-{'symbol','period','start_date','end_date','adjust'}: raise ValueError('Unsupported history arguments')
        if args.get('period','daily')!='daily': raise ValueError('Only daily history is supported')
    elif name in ('stock_zh_a_daily','stock_zh_a_hist_tx'):
        if set(args)-{'symbol','start_date','end_date','adjust'}: raise ValueError('Unsupported Sina history arguments')
    else: raise ValueError('Interface is not whitelisted')
    if name in ('stock_zh_a_hist','stock_zh_a_daily','stock_zh_a_hist_tx'):
        if not re.fullmatch(r'\d{6}' if name=='stock_zh_a_hist' else r'(sh|sz|bj)\d{6}',args.get('symbol','')): raise ValueError('Invalid A-share symbol')
        if args.get('adjust','') not in ('','qfq','hfq'): raise ValueError('Unsupported adjustment')
        for key in ('start_date','end_date'):
            datetime.datetime.strptime(args[key],'%Y%m%d')
        if args['start_date']>args['end_date']: raise ValueError('Date range must be ascending')
    frame=getattr(ak,name)(**args)
    if len(frame)>100000: raise ValueError('Row budget exceeded; narrow the date range')
    rows=[{str(k):value(v) for k,v in row.items()} for row in frame.to_dict(orient='records')]
    # AKShare 1.19.1 excludes all sz000* symbols from its lot-to-share conversion,
    # including A-share 000001. This whitelist only accepts A-share prefixes.
    # Preserve raw volume and explicitly normalize this known stock case.
    if name=='stock_zh_a_hist_tx' and args['symbol'].startswith('sz000'):
        for row in rows:
            row['native_volume']=row['volume']
            row['volume']=format(decimal.Decimal(row['volume'])*100,'f')
            row['volume_normalization']='AKShare1.19.1 sz000 A-share native lot x100 to share'
    return {'ok':True,'rows':rows,'akshareVersion':ak.__version__,'interface':name,'observedAt':int(datetime.datetime.now(datetime.timezone.utc).timestamp()*1000)}
try: print(json.dumps(query(json.load(sys.stdin)),ensure_ascii=False,allow_nan=False))
except Exception as exc: print(json.dumps({'ok':False,'error':type(exc).__name__+': '+str(exc)},ensure_ascii=False))
