"""Actual Cerebro bar simulation, fixed inputs, no broker gateway setup."""
import sys,json,math,importlib.util,importlib.metadata,traceback
from pathlib import Path
from datetime import datetime,timezone
from decimal import Decimal
import backtrader as bt

def text(v):
 if not math.isfinite(float(v)):raise ValueError('Nonfinite engine output')
 return format(Decimal(str(v)),'f')
def main(p):
 spec=importlib.util.spec_from_file_location('sesame_authored_strategy',p['strategy_path']);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);strategy=getattr(m,p['class_name'])
 if not isinstance(strategy,type) or not issubclass(strategy,bt.Strategy):raise ValueError('Class must derive from backtrader.Strategy')
 rows=p['rows'];dates=[datetime.fromisoformat(r['datetime'].replace('Z','+00:00')).astimezone(timezone.utc).replace(tzinfo=None) for r in rows]
 if any(dates[i]>=dates[i+1] for i in range(len(dates)-1)):raise ValueError('Input UTC timestamps must strictly increase')
 class FixedFeed(bt.feed.DataBase):
  def start(self):super().start();self.index=0
  def _load(self):
   if self.index>=len(rows):return False
   i=self.index;r=rows[i];self.index+=1;self.lines.datetime[0]=bt.date2num(dates[i])
   for key in ['open','high','low','close','volume']:getattr(self.lines,key)[0]=float(r[key])
   self.lines.openinterest[0]=0;return True
 orders=[];trades=[];equity=[]
 class Audited(strategy):
  def notify_order(self,order):
   orders.append({'orderId':str(order.ref),'status':order.getstatusname(),'size':text(order.size),'executedSize':text(order.executed.size),'executedPrice':text(order.executed.price),'commission':text(order.executed.comm),'time':bt.num2date(self.data.datetime[0]).replace(tzinfo=timezone.utc).isoformat()});super().notify_order(order)
  def notify_trade(self,trade):
   if trade.isclosed:trades.append({'tradeId':str(trade.ref),'pnl':text(trade.pnl),'pnlAfterCommission':text(trade.pnlcomm),'commission':text(trade.commission),'openTime':bt.num2date(trade.dtopen).replace(tzinfo=timezone.utc).isoformat(),'closeTime':bt.num2date(trade.dtclose).replace(tzinfo=timezone.utc).isoformat()})
   super().notify_trade(trade)
  def next(self):
   equity.append({'time':bt.num2date(self.data.datetime[0]).replace(tzinfo=timezone.utc).isoformat(),'value':text(self.broker.getvalue()),'cash':text(self.broker.getcash())});super().next()
 config=p['config'];c=bt.Cerebro(stdstats=False);c.adddata(FixedFeed());c.addstrategy(Audited,**p.get('parameters',{}));c.broker.setcash(float(config['capital']));c.broker.setcommission(commission=float(config['commission']),stocklike=True,percabs=True);c.broker.set_slippage_perc(float(config['slippage']));c.run(runonce=False)
 return {'status':'completed','engine':{'name':'Backtrader Cerebro','version':importlib.metadata.version('backtrader')},'statistics':{'finalEquity':text(c.broker.getvalue()),'finalCash':text(c.broker.getcash()),'closedTrades':len(trades)},'equity':equity,'trades':trades,'orders':orders,'limitations':['Stocklike cash simulation; no derivative margin or live broker.','Native binary floating-point engine; decimal output text is not decimal34 equivalence.','No SVL translation or equivalence is inferred.']}
if __name__=='__main__':
 output=Path(sys.argv[2]);code=0
 try:result=main(json.loads(Path(sys.argv[1]).read_text()))
 except Exception as e:result={'status':'failed','error':{'type':type(e).__name__,'message':str(e)},'equity':[],'orders':[],'trades':[]};code=1
 output.write_text(json.dumps(result,allow_nan=False));sys.exit(code)
