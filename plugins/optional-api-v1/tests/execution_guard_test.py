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
from unittest import mock

ROOT = Path(__file__).resolve().parents[1] / "packages"
FIXED_NOW = 1792575200000  # 2026-10-21, synthetic UTC; never the real SDK.
CLOCK_REVISION = "ftmo-demo-current-tick-2026-v1"
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mt = load("fixture_mt5_guard", "mt5/backend/execution_guard.py")
qmt = load("fixture_qmt_guard", "qmt/execution_guard.py")


class Clock:
    def __init__(self): self.now = FIXED_NOW
    def __call__(self): return self.now
    def monotonic(self): return self.now / 1000


class MT5:
    TRADE_ACTION_DEAL, TRADE_ACTION_PENDING, TRADE_ACTION_REMOVE = 1, 5, 8
    ORDER_STATE_PLACED, ORDER_STATE_PARTIAL = 1, 3
    ORDER_TYPE_BUY, ORDER_TYPE_SELL, ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT = 0, 1, 2, 3
    POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1
    def __init__(self, clock):
        self.clock, self.sent, self.calls = clock, [], []
        self.account = N(login=42, server="FTMO-Demo", trade_allowed=True, trade_expert=True)
        self.terminal = N(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.spec = N(volume_min=0.01, volume_max=10, volume_step=0.01)
        self.quote_age, self.ask, self.bid, self.check_delay, self.check_retcode = 0, 101, 100, 0, 0
        self.positions = [N(ticket=100, symbol="FIXTURE", volume=0.1, type=0)]
        self.orders = []
    def account_info(self): self.calls.append("account"); return self.account
    def terminal_info(self): self.calls.append("terminal"); return self.terminal
    def symbol_info(self, symbol): self.calls.append("spec"); return self.spec
    def positions_get(self, ticket=None, symbol=None):
        return tuple(row for row in self.positions if (ticket is None or row.ticket == ticket) and (symbol is None or row.symbol == symbol))
    def orders_get(self, symbol): return tuple(row for row in self.orders if row.symbol == symbol)
    def symbol_info_tick(self, symbol):
        self.calls.append("quote")
        return N(time_msc=self.clock()-self.quote_age+10800000, ask=self.ask, bid=self.bid)
    def order_check(self, request):
        self.calls.append("check"); self.clock.now += self.check_delay
        return N(retcode=self.check_retcode)
    def last_error(self): self.calls.append("last_error"); return (1, "success")
    def order_send(self, request):
        self.calls.append("send"); self.sent.append(dict(request)); self.clock.now += 20
        return N(retcode=10009, order=123)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock(); self.mt = MT5(self.clock)
        self.guard = {"observed_at":self.clock(),"expires_at":self.clock()+60000,"max_quote_age_ms":5000,"max_quote_to_send_ms":1000,"price_limit":"102","side":"buy","expected_account":"42","expected_server":"FTMO-Demo","quote_clock_revision":CLOCK_REVISION}
        self.request = {"action":1,"symbol":"FIXTURE","type":0,"volume":0.1}
    def send(self): return mt.guarded_send(self.mt,self.request,self.guard,self.clock,self.clock.monotonic)
    def test_mt5_checks_refreshes_then_sends_once_and_reports_real_phase_times(self):
        self.mt.check_delay = 2500
        result, timing = self.send()
        self.assertEqual(result.order,123);self.assertEqual(len(self.mt.sent),1)
        self.assertEqual(self.mt.calls,["account","terminal","spec","account","terminal","quote","account","terminal","check","account","terminal","quote","account","terminal","account","terminal","send"])
        self.assertEqual(timing["native_preflight_ms"],2500);self.assertEqual(timing["send_to_receipt_ms"],20)
        self.assertEqual(timing["source_time_ms"],FIXED_NOW+2500)
        self.assertEqual(timing["raw_source_time_ms"],FIXED_NOW+2500+10800000)
        self.assertEqual(timing["quote_clock"]["ruleRevision"],CLOCK_REVISION)
        self.assertEqual(timing["quote_clock"]["offsetMinutes"],180)
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
    def test_mt5_rejected_order_check_retains_native_object_and_immediate_last_error(self):
        checked = N(retcode=10030, comment="Fixture filling rejected", margin=12.5, request=N(symbol="FIXTURE", volume=0.1))
        def check_order(request): self.mt.calls.append("check"); return checked
        self.mt.order_check = check_order
        with self.assertRaises(mt.GuardRejected) as caught: self.send()
        self.assertEqual(caught.exception.code, "ORDER_CHECK_REJECTED")
        self.assertIs(caught.exception.details["order_check"], checked)
        self.assertEqual(caught.exception.details["last_error"], (1, "success"))
        self.assertEqual(self.mt.calls[-2:], ["check", "last_error"])
        self.assertEqual(self.mt.calls.count("check"), 1); self.assertFalse(self.mt.sent)
    def test_mt5_null_order_check_retains_native_error_without_inventing_retcode(self):
        def check_order(request): self.mt.calls.append("check"); return None
        def last_error(): self.mt.calls.append("last_error"); return (-2, "Fixture invalid price")
        self.mt.order_check, self.mt.last_error = check_order, last_error
        with self.assertRaises(mt.GuardRejected) as caught: self.send()
        self.assertEqual(caught.exception.code, "ORDER_CHECK_REJECTED")
        self.assertEqual(caught.exception.details, {"order_check": None, "last_error": (-2, "Fixture invalid price")})
        self.assertEqual(self.mt.calls[-2:], ["check", "last_error"])
        self.assertEqual(self.mt.calls.count("check"), 1); self.assertFalse(self.mt.sent)
    def test_mt5_close_requires_matching_current_opposite_position(self):
        self.request.update(position=100,type=1);self.guard.update(side='sell',price_limit='99')
        self.send();self.assertEqual(len(self.mt.sent),1)
        self.mt.sent=[];self.request['volume']=0.2
        with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'POSITION_CHANGED');self.assertFalse(self.mt.sent)
    def test_mt5_changes_during_order_check_reject_before_final_send(self):
        changes = [(lambda:setattr(self.mt.account,'login',43),'ACCOUNT_MISMATCH'),(lambda:setattr(self.mt.account,'server','Other'),'ACCOUNT_MISMATCH'),(lambda:setattr(self.mt.account,'trade_allowed',False),'FORBIDDEN'),(lambda:setattr(self.mt.terminal,'tradeapi_disabled',True),'FORBIDDEN')]
        for mutate,code in changes:
            self.setUp()
            def checked(request):mutate();return N(retcode=0)
            self.mt.order_check=checked
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,code);self.assertFalse(self.mt.sent)
    def test_mt5_close_revalidates_exact_position_after_native_check(self):
        for changed in ([],[N(ticket=100,symbol='FIXTURE',volume=0.05,type=0)],[N(ticket=101,symbol='FIXTURE',volume=0.1,type=0)],[N(ticket=100,symbol='OTHER',volume=0.1,type=0)],[N(ticket=100,symbol='FIXTURE',volume=0.1,type=1)]):
            self.setUp();self.request.update(position=100,type=1);self.guard.update(side='sell',price_limit='99')
            def checked(request):self.mt.positions_get=lambda ticket:changed;return N(retcode=0)
            self.mt.order_check=checked
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,'POSITION_CHANGED');self.assertFalse(self.mt.sent)
    def test_mt5_final_verification_time_is_inside_quote_to_send_budget(self):
        original=self.mt.account_info;calls=0
        def slow_final_account():
            nonlocal calls
            calls+=1
            if calls==6:self.clock.now+=1001
            return original()
        self.mt.account_info=slow_final_account
        with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'LATENCY_BUDGET_EXCEEDED');self.assertFalse(self.mt.sent)
    def test_mt5_quote_age_is_checked_after_final_account_and_terminal_reads(self):
        self.mt.quote_age=4800;original=self.mt.terminal_info;calls=0
        def slow_final_terminal():
            nonlocal calls
            calls+=1
            if calls==6:self.clock.now+=300
            return original()
        self.mt.terminal_info=slow_final_terminal
        with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'STALE_QUOTE');self.assertFalse(self.mt.sent)
    def test_mt5_clock_rule_is_required_and_unknown_server_or_old_period_never_sends(self):
        for problem,code in [('missing','INVALID_ARGUMENT'),('revision','QUOTE_CLOCK_REVISION_CHANGED'),('server','QUOTE_CLOCK_UNVERIFIED'),('old','QUOTE_CLOCK_UNVERIFIED')]:
            self.setUp()
            if problem=='missing':self.guard.pop('quote_clock_revision')
            if problem=='revision':self.guard['quote_clock_revision']='old-rule'
            if problem=='server':self.mt.account.server='Other';self.guard['expected_server']='Other'
            if problem=='old':self.mt.symbol_info_tick=lambda symbol:N(time_msc=1700000000000,bid=100,ask=101)
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,code);self.assertFalse(self.mt.sent)
    def test_mt5_second_quote_independently_checks_clock_rule_and_future_source(self):
        original=self.mt.symbol_info_tick;reads=0
        def tick(symbol):
            nonlocal reads
            reads+=1
            if reads==2:self.mt.quote_age=-1
            return original(symbol)
        self.mt.symbol_info_tick=tick
        with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'STALE_QUOTE');self.assertFalse(self.mt.sent)
        self.setUp();resolve=mt._quote_clock.resolve_quote_clock;proofs=[]
        def changed_rule(*args,**kwargs):
            proof=resolve(*args,**kwargs);proofs.append(proof)
            return {**proof,'ruleRevision':'changed-rule'} if len(proofs)==2 else proof
        with mock.patch.object(mt._quote_clock,'resolve_quote_clock',side_effect=changed_rule):
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
        self.assertEqual(caught.exception.code,'QUOTE_CLOCK_REVISION_CHANGED');self.assertEqual(len(proofs),2);self.assertFalse(self.mt.sent)
    def test_mt5_quote_to_send_uses_monotonic_budget_even_if_wall_time_stalls(self):
        mono=[0.0];original=self.mt.terminal_info;calls=0
        def slow_final_terminal():
            nonlocal calls
            calls+=1
            if calls==6:mono[0]+=1.001
            return original()
        self.mt.terminal_info=slow_final_terminal
        with self.assertRaises(mt.GuardRejected) as caught:mt.guarded_send(self.mt,self.request,self.guard,self.clock,lambda:mono[0])
        self.assertEqual(caught.exception.code,'LATENCY_BUDGET_EXCEEDED');self.assertFalse(self.mt.sent)
    def test_mt5_account_switch_inside_either_native_tick_read_never_sends(self):
        for switch_on in (1,2):
            self.setUp();original=self.mt.symbol_info_tick;reads=0
            def tick(symbol):
                nonlocal reads
                reads+=1;result=original(symbol)
                if reads==switch_on:self.mt.account.login=43
                return result
            self.mt.symbol_info_tick=tick
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,'ACCOUNT_MISMATCH');self.assertFalse(self.mt.sent)
    def test_mt5_timeout_after_send_is_not_guard_rejection_or_retry(self):
        def send(request):self.mt.sent.append(request);raise TimeoutError('synthetic lost receipt')
        self.mt.order_send=send
        with self.assertRaises(TimeoutError):self.send()
        self.assertEqual(len(self.mt.sent),1)
    def test_mt5_expected_full_symbol_matches_sorted_decimal_amounts_and_sends_once(self):
        self.mt.positions.append(N(ticket=101,symbol='FIXTURE',volume=0.2,type=1))
        self.guard['expected_positions']=[{'ticket':'101','type':1,'volume':'0.20'},{'ticket':'100','type':0,'volume':'0.10'}]
        self.send();self.assertEqual(len(self.mt.sent),1)
    def test_mt5_changed_full_symbol_after_observation_or_order_check_never_sends(self):
        for during_check in (False,True):
            for change in ('added','amount','side','working'):
                self.setUp();self.guard['expected_positions']=[{'ticket':'100','type':0,'volume':'0.1'}]
                # Even a close with its original ticket unchanged must inspect other positions.
                self.request.update(position=100,type=1);self.guard.update(side='sell',price_limit='99')
                def mutate():
                    if change=='added':self.mt.positions.append(N(ticket=101,symbol='FIXTURE',volume=0.2,type=1))
                    if change=='amount':self.mt.positions[0].volume=0.2
                    if change=='side':self.mt.positions[0].type=1
                    if change=='working':self.mt.orders.append(N(ticket=700,symbol='FIXTURE'))
                if during_check:
                    def checked(request):mutate();return N(retcode=0)
                    self.mt.order_check=checked
                else:mutate()
                with self.assertRaises(mt.GuardRejected) as caught:self.send()
                self.assertEqual(caught.exception.code,'WORKING_ORDERS' if change=='working' else 'POSITION_CHANGED');self.assertFalse(self.mt.sent)
    def test_mt5_expected_empty_symbol_and_final_quote_race_are_guarded(self):
        self.mt.positions=[];self.guard['expected_positions']=[]
        self.send();self.assertEqual(len(self.mt.sent),1)
        for change in ('position','working'):
            self.setUp();self.mt.positions=[];self.guard['expected_positions']=[];original=self.mt.symbol_info_tick;quotes=0
            def tick(symbol):
                nonlocal quotes
                quotes+=1
                if quotes==2:
                    if change=='position':self.mt.positions.append(N(ticket=101,symbol='FIXTURE',volume=0.2,type=0))
                    else:self.mt.orders.append(N(ticket=700,symbol='FIXTURE'))
                return original(symbol)
            self.mt.symbol_info_tick=tick
            with self.assertRaises(mt.GuardRejected) as caught:self.send()
            self.assertEqual(caught.exception.code,'POSITION_CHANGED' if change=='position' else 'WORKING_ORDERS');self.assertFalse(self.mt.sent)
    def test_mt5_cancel_checks_native_account_and_unique_active_order_after_queuing(self):
        guard = {"expected_account":"42","expected_server":"FTMO-Demo","symbol":"FIXTURE","remark":"SOwn","order":"700","side":"buy"}
        request = {"action":8,"order":700}
        row = dict(ticket=700,symbol="FIXTURE",comment="SOwn",type=2,state=1,volume_current=0.1)
        self.mt.orders_get = lambda **kwargs: [N(**row)]
        result, timing = mt.guarded_cancel(self.mt,request,guard,self.clock)
        self.assertEqual(result.retcode,10009); self.assertEqual(len(self.mt.sent),1); self.assertEqual(timing["send_to_receipt_ms"],20)
        for changed in ({"ticket":701},{"symbol":"OTHER"},{"comment":"foreign"},{"type":3},{"state":4},{"volume_current":0}):
            self.mt.sent=[]; self.mt.orders_get=lambda **kwargs:[N(**{**row,**changed})]
            with self.assertRaises(mt.GuardRejected): mt.guarded_cancel(self.mt,request,guard,self.clock)
            self.assertFalse(self.mt.sent)
        self.mt.orders_get=lambda **kwargs:[N(**row),N(**{**row,"ticket":701})]
        with self.assertRaises(mt.GuardRejected): mt.guarded_cancel(self.mt,request,guard,self.clock)
        def switch_account(**kwargs):
            self.mt.account.login=43
            return [N(**row)]
        self.mt.orders_get=switch_account
        with self.assertRaises(mt.GuardRejected) as caught: mt.guarded_cancel(self.mt,request,guard,self.clock)
        self.assertEqual(caught.exception.code,"ACCOUNT_MISMATCH"); self.assertFalse(self.mt.sent)
    def qmt_fixture(self):
        clock=self.clock;state=N(sent=0,cash=100000,volume=100,available=100,age=0,ask=10.1,delay=0,orders=[],on_tick=None)
        def asset(account):
            clock.now+=state.delay
            return N(account_id='fixture',cash=state.cash)
        trader=N(query_stock_asset=asset,query_stock_positions=lambda account:[N(account_id='fixture',stock_code='600000.SH',volume=state.volume,can_use_volume=state.available)],query_stock_orders=lambda account:state.orders)
        def tick(symbols):
            if state.on_tick:state.on_tick()
            return {'600000.SH':{'time':clock()-state.age,'bidPrice':[10],'askPrice':[state.ask]}}
        data=N(get_full_tick=tick)
        req={'account_id':'fixture','symbol':'600000.SH','side':'buy','shares':'100','price':'10','execution_guard':{k:v for k,v in self.guard.items() if k not in ('side','expected_account','expected_server','quote_clock_revision')}}
        req['execution_guard']['price_limit']='10.2'
        def send():state.sent+=1;clock.now+=15;return 123
        def execute():return qmt.submit(trader,object(),data,{'PriceTick':'0.01','MinLimitOrderVolume':'100','MaxLimitOrderVolume':'100000'},req,send,clock,clock.monotonic)
        return state,req,execute
    def test_qmt_checks_native_account_quote_then_sends_once(self):
        state,request,execute=self.qmt_fixture();order,timing=execute()
        self.assertEqual(order,123);self.assertEqual(state.sent,1);self.assertEqual(timing['send_to_receipt_ms'],15)
    def qmt_expected(self,request):
        request['execution_guard']['expected_positions']=[{'account_id':'fixture','stock_code':'600000.SH','volume':'100','can_use_volume':'100'}]
    def test_qmt_full_position_expectation_matched_and_terminal_orders_send_once(self):
        for status in (None,53,54,56,57):
            self.setUp();state,request,execute=self.qmt_fixture();self.qmt_expected(request)
            if status is not None:state.orders=[N(account_id='fixture',stock_code='600000.SH',order_status=status)]
            execute();self.assertEqual(state.sent,1)
    def test_qmt_buy_detects_changed_positions_before_quote_and_during_quote(self):
        for final in (False,True):
            for field in ('volume','available'):
                self.setUp();state,request,execute=self.qmt_fixture();self.qmt_expected(request)
                def mutate():setattr(state,field,200 if field=='volume' else 99)
                if final:state.on_tick=mutate
                else:mutate()
                with self.assertRaises(qmt.GuardRejected) as caught:execute()
                self.assertEqual(caught.exception.code,'POSITION_CHANGED');self.assertEqual(state.sent,0)
    def test_qmt_pending_canceling_unknown_or_missing_order_status_never_sends(self):
        for status in (48,49,50,51,52,55,255,None):
            for final in (False,True):
                self.setUp();state,request,execute=self.qmt_fixture();self.qmt_expected(request)
                def mutate():state.orders=[N(account_id='fixture',stock_code='600000.SH',**({} if status is None else {'order_status':status}))]
                if final:state.on_tick=mutate
                else:mutate()
                with self.assertRaises(qmt.GuardRejected) as caught:execute()
                self.assertEqual(caught.exception.code,'WORKING_ORDERS');self.assertEqual(state.sent,0)
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
    def run_worker(self, expired=False, guarded=True, cancel=False, changed_account=False, portfolio=False, change='', check_failure=''):
        # Fixed stand-ins supplied only to this subprocess. No real SDK import.
        with tempfile.TemporaryDirectory(prefix='sesame-guard-fixture-') as tmp:
            directory=Path(tmp);audit=directory/'sent.txt';check_audit=directory/'checks.txt'
            (directory/'numpy.py').write_text('class ndarray: pass\nclass generic: pass\n')
            (directory/'MetaTrader5.py').write_text('''
import os,time
time.time=lambda:1792575200.0
class R:
 def __init__(self,**values): self.__dict__.update(values)
 def _asdict(self): return self.__dict__
__version__='fixture'
TRADE_ACTION_DEAL=1
TRADE_ACTION_PENDING=5
TRADE_ACTION_REMOVE=8
ORDER_STATE_PLACED=1
ORDER_STATE_PARTIAL=3
ORDER_TYPE_BUY=0
ORDER_TYPE_SELL=1
ORDER_TYPE_BUY_LIMIT=2
ORDER_TYPE_SELL_LIMIT=3
POSITION_TYPE_BUY=0
POSITION_TYPE_SELL=1
def account_info(): return R(login=int(os.environ.get('SESAME_FIXTURE_ACCOUNT','42')),server='FTMO-Demo',trade_allowed=True,trade_expert=True)
def terminal_info(): return R(connected=True,trade_allowed=True,tradeapi_disabled=False)
def symbol_info(symbol): return R(volume_min=0.01,volume_max=1,volume_step=0.01)
def symbol_info_tick(symbol): return R(time_msc=int(time.time()*1000)+10800000,bid=100,ask=101)
positions=[]
orders=[]
def order_check(request):
 with open(os.environ['SESAME_FIXTURE_CHECK_AUDIT'],'a') as f: f.write('check\\n')
 failure=os.environ.get('SESAME_FIXTURE_CHECK_FAILURE')
 if failure=='none': return None
 if failure=='reject': return R(retcode=10030,comment='Fixture filling rejected',margin=12.5,request=R(**request))
 if os.environ.get('SESAME_FIXTURE_CHANGE')=='position': positions.append(R(ticket=100,symbol='FIXTURE',type=0,volume=0.1))
 if os.environ.get('SESAME_FIXTURE_CHANGE')=='working': orders.append(R(ticket=701,symbol='FIXTURE'))
 return R(retcode=0)
def positions_get(**kwargs): return positions
def orders_get(**kwargs):
 if os.environ.get('SESAME_FIXTURE_PORTFOLIO')=='1': return orders
 return [R(ticket=700,symbol='FIXTURE',comment='SOwn',type=2,state=1,volume_current=0.1)]
def order_send(request):
 with open(os.environ['SESAME_FIXTURE_AUDIT'],'a') as f: f.write('sent\\n')
 return R(retcode=10009,order=123)
def last_error():
 with open(os.environ['SESAME_FIXTURE_CHECK_AUDIT'],'a') as f: f.write('last_error\\n')
 return (-2,'Fixture invalid price') if os.environ.get('SESAME_FIXTURE_CHECK_FAILURE')=='none' else (1,'success')
def shutdown(): pass
''')
            now=FIXED_NOW-(61000 if expired else 0)
            guard={'observed_at':now,'expires_at':now+60000,'max_quote_age_ms':5000,'max_quote_to_send_ms':1000,'price_limit':'102','side':'buy','expected_account':'42','expected_server':'FTMO-Demo','quote_clock_revision':CLOCK_REVISION}
            if portfolio:guard['expected_positions']=[]
            args={'request':{'action':'TRADE_ACTION_DEAL','type':'ORDER_TYPE_BUY','symbol':'FIXTURE','volume':0.1}}
            if guarded:args['execution_guard']=guard
            if cancel:args={'request':{'action':'TRADE_ACTION_REMOVE','order':'700'},'cancellation_guard':{'expected_account':'42','expected_server':'FTMO-Demo','symbol':'FIXTURE','remark':'SOwn','order':'700','side':'buy'}}
            request={'tool':'order_send','arguments':args}
            result=subprocess.run([sys.executable,'-B',str(ROOT/'mt5/backend/python-worker.py')],input=json.dumps(request)+'\n',text=True,capture_output=True,env={**os.environ,'PYTHONPATH':tmp,'SESAME_FIXTURE_AUDIT':str(audit),'SESAME_FIXTURE_CHECK_AUDIT':str(check_audit),'SESAME_FIXTURE_CHECK_FAILURE':check_failure,'SESAME_FIXTURE_ACCOUNT':'43' if changed_account else '42','SESAME_FIXTURE_PORTFOLIO':'1' if portfolio else '0','SESAME_FIXTURE_CHANGE':change},timeout=5,check=True)
            if check_failure: self.assertEqual(check_audit.read_text().splitlines(), ['check', 'last_error'])
            return json.loads(result.stdout.strip()),audit.read_text().splitlines() if audit.exists() else []
    def test_actual_worker_consumes_guard_and_preserves_native_result(self):
        result,sends=self.run_worker()
        self.assertEqual(sends,['sent']);self.assertEqual(result['result']['order'],'123');self.assertIn('execution_timing',result)
    def test_actual_worker_marks_expired_as_known_not_sent(self):
        result,sends=self.run_worker(expired=True)
        self.assertEqual(sends,[]);self.assertEqual(result['error'],'SIGNAL_EXPIRED');self.assertIs(result['submission_attempted'],False)
        self.assertEqual(set(result), {'error', 'message', 'submission_attempted'})
    def test_actual_worker_preserves_rejected_native_check_diagnostics_without_sending(self):
        result,sends=self.run_worker(check_failure='reject')
        self.assertEqual(sends,[]);self.assertEqual(result['error'],'ORDER_CHECK_REJECTED');self.assertIs(result['submission_attempted'],False)
        self.assertEqual(result['last_error'],[1,'success'])
        self.assertEqual(result['order_check'],{'retcode':10030,'comment':'Fixture filling rejected','margin':12.5,
            'request':{'action':1,'type':0,'symbol':'FIXTURE','volume':0.1,'price':101.0}})
        self.assertNotIn('result',result)
    def test_actual_worker_preserves_null_native_check_and_last_error_without_sending(self):
        result,sends=self.run_worker(check_failure='none')
        self.assertEqual(sends,[]);self.assertEqual(result['error'],'ORDER_CHECK_REJECTED');self.assertIs(result['submission_attempted'],False)
        self.assertIsNone(result['order_check']);self.assertEqual(result['last_error'],[-2,'Fixture invalid price'])
        self.assertNotIn('result',result)
    def test_actual_worker_rechecks_full_positions_and_orders_after_check(self):
        result,sends=self.run_worker(portfolio=True)
        self.assertEqual(sends,['sent']);self.assertEqual(result['result']['retcode'],10009)
        for change,code in [('position','POSITION_CHANGED'),('working','WORKING_ORDERS')]:
            result,sends=self.run_worker(portfolio=True,change=change)
            self.assertEqual(sends,[]);self.assertEqual(result['error'],code);self.assertIs(result['submission_attempted'],False)
    def test_existing_unguarded_worker_call_remains_compatible(self):
        result,sends=self.run_worker(guarded=False)
        self.assertEqual(sends,['sent']);self.assertEqual(result['result']['retcode'],10009);self.assertNotIn('execution_timing',result)
    def test_actual_worker_cancel_rechecks_account_instead_of_sending_bare_ticket(self):
        result,sends=self.run_worker(cancel=True)
        self.assertEqual(sends,['sent']);self.assertIn('cancellation_verified_at',result['execution_timing'])
        result,sends=self.run_worker(cancel=True,changed_account=True)
        self.assertEqual(sends,[]);self.assertEqual(result['error'],'ACCOUNT_MISMATCH');self.assertIs(result['submission_attempted'],False)


if __name__ == '__main__':unittest.main()
