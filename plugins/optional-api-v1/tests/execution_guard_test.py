"""Fictional SDK fixtures only. No SDK import, terminal, broker, or network."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as N
import unittest
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1] / "packages"
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mt = load("fixture_mt5_guard", "mt5/backend/execution_guard.py")
qmt = load("fixture_qmt_guard", "qmt/execution_guard.py")


class Clock:
    def __init__(self): self.now = 1800000000000
    def __call__(self): return self.now
    def monotonic(self): return self.now / 1000


class MT5:
    TRADE_ACTION_DEAL, TRADE_ACTION_PENDING = 1, 5
    ORDER_TYPE_BUY, ORDER_TYPE_SELL, ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT = 0, 1, 2, 3
    POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1
    def __init__(self, clock):
        self.clock, self.sent, self.calls = clock, [], []
        self.account = N(login=42, server="Fixture-Demo", trade_allowed=True, trade_expert=True)
        self.terminal = N(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.spec = N(volume_min=0.01, volume_max=10, volume_step=0.01)
        self.quote_age, self.ask, self.bid, self.check_delay, self.check_retcode = 0, 101, 100, 0, 0
    def account_info(self): self.calls.append("account"); return self.account
    def terminal_info(self): self.calls.append("terminal"); return self.terminal
    def symbol_info(self, symbol): self.calls.append("spec"); return self.spec
    def positions_get(self, ticket): return (N(symbol="FIXTURE", volume=0.1, type=0),)
    def symbol_info_tick(self, symbol):
        self.calls.append("quote")
        return N(time_msc=self.clock()-self.quote_age, ask=self.ask, bid=self.bid)
    def order_check(self, request):
        self.calls.append("check"); self.clock.now += self.check_delay
        return N(retcode=self.check_retcode)
    def order_send(self, request):
        self.calls.append("send"); self.sent.append(dict(request)); self.clock.now += 20
        return N(retcode=10009, order=123)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock(); self.mt = MT5(self.clock)
        self.guard = {"observed_at":self.clock(),"expires_at":self.clock()+60000,"max_quote_age_ms":5000,"max_quote_to_send_ms":1000,"price_limit":"102","side":"buy","expected_account":"42","expected_server":"Fixture-Demo"}
        self.request = {"action":1,"symbol":"FIXTURE","type":0,"volume":0.1}
    def send(self): return mt.guarded_send(self.mt,self.request,self.guard,self.clock,self.clock.monotonic)
    def test_mt5_checks_refreshes_then_sends_once_and_reports_real_phase_times(self):
        self.mt.check_delay = 2500
        result, timing = self.send()
        self.assertEqual(result.order,123);self.assertEqual(len(self.mt.sent),1)
        self.assertEqual(self.mt.calls,["account","terminal","spec","quote","check","quote","send"])
        self.assertEqual(timing["native_preflight_ms"],2500);self.assertEqual(timing["send_to_receipt_ms"],20)
        self.assertEqual(timing["source_time_ms"],1800000002500)
    def test_mt5_queue_delay_past_expiry_never_sends(self):
        self.clock.now += 60001
        with self.assertRaises(mt.GuardRejected) as caught: self.send()
        self.assertEqual(caught.exception.code,"SIGNAL_EXPIRED");self.assertFalse(self.mt.sent)
    def test_mt5_slow_order_check_expires_without_sending(self):
        self.mt.check_delay = 60001
        with self.assertRaises(mt.GuardRejected) as caught: self.send()
        self.assertEqual(caught.exception.code,"SIGNAL_EXPIRED");self.assertFalse(self.mt.sent)
    def test_mt5_stale_future_and_missing_ticks_refuse_send(self):
        for age in (5001,-1):
            self.mt.quote_age=age
            with self.assertRaises(mt.GuardRejected) as caught: self.send()
            self.assertEqual(caught.exception.code,"STALE_QUOTE")
        self.mt.symbol_info_tick=lambda symbol:None
        with self.assertRaises(mt.GuardRejected): self.send()
        self.assertFalse(self.mt.sent)
    def test_mt5_account_permission_price_quantity_and_check_fail_closed(self):
        variants = [(lambda:setattr(self.mt.account,'login',43),'ACCOUNT_MISMATCH'),(lambda:setattr(self.mt.terminal,'tradeapi_disabled',True),'FORBIDDEN'),(lambda:setattr(self.mt,'ask',103),'PRICE_MOVED'),(lambda:self.request.update(volume=0.015),'INVALID_ARGUMENT'),(lambda:setattr(self.mt,'check_retcode',10019),'ORDER_CHECK_REJECTED')]
        for mutate,code in variants:
            self.setUp();mutate()
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,code);self.assertFalse(self.mt.sent)
    def test_mt5_close_requires_matching_current_opposite_position(self):
        self.request.update(position=100,type=1);self.guard.update(side='sell',price_limit='99')
        self.send();self.assertEqual(len(self.mt.sent),1)
        self.mt.sent=[];self.request['volume']=0.2
        with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'POSITION_CHANGED');self.assertFalse(self.mt.sent)
    def test_mt5_timeout_after_send_is_not_guard_rejection_or_retry(self):
        def send(request):self.mt.sent.append(request);raise TimeoutError('synthetic lost receipt')
        self.mt.order_send=send
        with self.assertRaises(TimeoutError):self.send()
        self.assertEqual(len(self.mt.sent),1)
    def qmt_fixture(self):
        clock=self.clock;state=N(sent=0,cash=100000,available=100,age=0,ask=10.1,delay=0)
        def asset(account):
            clock.now+=state.delay
            return N(account_id='fixture',cash=state.cash)
        trader=N(query_stock_asset=asset,query_stock_positions=lambda account:[N(account_id='fixture',stock_code='600000.SH',can_use_volume=state.available)])
        data=N(get_full_tick=lambda symbols:{'600000.SH':{'time':clock()-state.age,'bidPrice':[10],'askPrice':[state.ask]}})
        req={'account_id':'fixture','symbol':'600000.SH','side':'buy','shares':'100','price':'10','execution_guard':{k:v for k,v in self.guard.items() if k not in ('side','expected_account','expected_server')}}
        req['execution_guard']['price_limit']='10.2'
        def send():state.sent+=1;clock.now+=15;return 123
        def execute():return qmt.submit(trader,object(),data,{'PriceTick':'0.01','MinLimitOrderVolume':'100','MaxLimitOrderVolume':'100000'},req,send,clock,clock.monotonic)
        return state,req,execute
    def test_qmt_checks_native_account_quote_then_sends_once(self):
        state,request,execute=self.qmt_fixture();order,timing=execute()
        self.assertEqual(order,123);self.assertEqual(state.sent,1);self.assertEqual(timing['send_to_receipt_ms'],15)
    def test_qmt_slow_startup_and_reads_cannot_send_stale_decision(self):
        state,request,execute=self.qmt_fixture();self.clock.now+=60001
        with self.assertRaises(qmt.GuardRejected):execute()
        self.assertEqual(state.sent,0)
        self.setUp();state,request,execute=self.qmt_fixture();state.delay=60001
        with self.assertRaises(qmt.GuardRejected):execute()
        self.assertEqual(state.sent,0)
    def test_qmt_cash_available_shares_price_step_and_stale_tick(self):
        for problem,code in [('cash','INSUFFICIENT_FUNDS'),('shares','POSITION_CHANGED'),('stale','STALE_QUOTE'),('future','STALE_QUOTE'),('boundary','PRICE_MOVED'),('tick','INVALID_ARGUMENT')]:
            self.setUp();state,request,execute=self.qmt_fixture()
            if problem=='cash':state.cash=0
            if problem=='shares':request['side']='sell';request['execution_guard']['price_limit']='9.9';state.available=0
            if problem=='stale':state.age=5001
            if problem=='future':state.age=-1
            if problem=='boundary':state.ask=10.3
            if problem=='tick':request['price']='10.001'
            with self.assertRaises(qmt.GuardRejected) as caught:execute()
            self.assertEqual(caught.exception.code,code);self.assertEqual(caught.exception.details,{'submission_attempted':False});self.assertEqual(state.sent,0)


class WorkerBoundaryTests(unittest.TestCase):
    def run_worker(self, expired=False, guarded=True):
        # Fixed stand-ins supplied only to this subprocess. No real SDK import.
        with tempfile.TemporaryDirectory(prefix='sesame-guard-fixture-') as tmp:
            directory=Path(tmp);audit=directory/'sent.txt'
            (directory/'numpy.py').write_text('class ndarray: pass\nclass generic: pass\n')
            (directory/'MetaTrader5.py').write_text('''
import os,time
class R:
 def __init__(self,**values): self.__dict__.update(values)
 def _asdict(self): return self.__dict__
__version__='fixture'
TRADE_ACTION_DEAL=1
TRADE_ACTION_PENDING=5
ORDER_TYPE_BUY=0
ORDER_TYPE_SELL=1
ORDER_TYPE_BUY_LIMIT=2
ORDER_TYPE_SELL_LIMIT=3
POSITION_TYPE_BUY=0
POSITION_TYPE_SELL=1
def account_info(): return R(login=42,server='Fixture',trade_allowed=True,trade_expert=True)
def terminal_info(): return R(connected=True,trade_allowed=True,tradeapi_disabled=False)
def symbol_info(symbol): return R(volume_min=0.01,volume_max=1,volume_step=0.01)
def symbol_info_tick(symbol): return R(time_msc=int(time.time()*1000),bid=100,ask=101)
def order_check(request): return R(retcode=0)
def order_send(request):
 with open(os.environ['SESAME_FIXTURE_AUDIT'],'a') as f: f.write('sent\\n')
 return R(retcode=10009,order=123)
def last_error(): return (1,'success')
def shutdown(): pass
''')
            now=int(time.time()*1000)-(61000 if expired else 0)
            guard={'observed_at':now,'expires_at':now+60000,'max_quote_age_ms':5000,'max_quote_to_send_ms':1000,'price_limit':'102','side':'buy','expected_account':'42','expected_server':'Fixture'}
            args={'request':{'action':'TRADE_ACTION_DEAL','type':'ORDER_TYPE_BUY','symbol':'FIXTURE','volume':0.1}}
            if guarded:args['execution_guard']=guard
            request={'tool':'order_send','arguments':args}
            result=subprocess.run([sys.executable,'-B',str(ROOT/'mt5/backend/python-worker.py')],input=json.dumps(request)+'\n',text=True,capture_output=True,env={**os.environ,'PYTHONPATH':tmp,'SESAME_FIXTURE_AUDIT':str(audit)},timeout=5,check=True)
            return json.loads(result.stdout.strip()),audit.read_text().splitlines() if audit.exists() else []
    def test_actual_worker_consumes_guard_and_preserves_native_result(self):
        result,sends=self.run_worker()
        self.assertEqual(sends,['sent']);self.assertEqual(result['result']['order'],'123');self.assertIn('execution_timing',result)
    def test_actual_worker_marks_expired_as_known_not_sent(self):
        result,sends=self.run_worker(expired=True)
        self.assertEqual(sends,[]);self.assertEqual(result['error'],'SIGNAL_EXPIRED');self.assertIs(result['submission_attempted'],False)
    def test_existing_unguarded_worker_call_remains_compatible(self):
        result,sends=self.run_worker(guarded=False)
        self.assertEqual(sends,['sent']);self.assertEqual(result['result']['retcode'],10009);self.assertNotIn('execution_timing',result)


if __name__ == '__main__':unittest.main()
