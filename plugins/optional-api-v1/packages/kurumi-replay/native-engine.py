"""NautilusTrader quote-tick prototype. stdin JSON -> stdout JSON; no downloads.
Matching, market orders and bid/ask stop triggering are native. No extra fixed-tick slippage.
Exact challenge ledger/CHF bid-vs-ask conversion/financing/stopout are explicit adapters.
Historical ticks must come from the data module; fixture tests are not historical data.
"""
import copy
import json
import sys
import hashlib
import pathlib
import time
from decimal import Decimal, localcontext, ROUND_HALF_UP
from datetime import datetime, timezone
import nautilus_trader
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.models import FeeModel, FillModel
from nautilus_trader.common.config import LoggingConfig
from nautilus_trader.risk.config import RiskEngineConfig
from nautilus_trader.trading.strategy import Strategy
from nautilus_trader.model.currencies import JPY
from nautilus_trader.model.objects import Currency, Money, Price, Quantity
from nautilus_trader.model.identifiers import InstrumentId, Symbol, Venue
from nautilus_trader.model.enums import AccountType, OmsType, OrderSide, TriggerType, OrderStatus
from nautilus_trader.model.instruments import CurrencyPair
from nautilus_trader.model.data import QuoteTick

HOUR = 3600000
DAY = 86400000
PROFILES = ({"leverage":"500", "stopout":"0.2"}, {"leverage":"25", "stopout":"0.5"}, {"leverage":"25", "stopout":"0.3"})
SESSION = None
VENUE = Venue("KURUMI")
D = Decimal

class InputError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


PROFILE_IDS = ('legacy-500-25-25-v1', 'informed-replay-50x-v1')
def profile_rules(state):
    r = state.get('rules', {})
    selected = r.get('experimentProfile')
    if 'experimentProfile' in r and (not isinstance(selected,dict) or not selected):
        raise InputError('RULES_MISMATCH','Malformed experiment profile; only absent field means legacy')
    profile_id = selected.get('id') if selected is not None else PROFILE_IDS[0]
    if profile_id not in PROFILE_IDS:
        raise InputError('RULES_MISMATCH', 'Unknown frozen experiment profile')
    leverage = ['500','25','25'] if profile_id == PROFILE_IDS[0] else ['50','50','50']
    rules = [{'leverage':lev,'stopout':stop} for lev,stop in zip(leverage,['0.2','0.5','0.3'])]
    content = {'schemaVersion':1,'id':profile_id,'initialBalance':'300000','victoryBalance':'20000000','currency':'JPY',
        'chapterRules':rules,'commissionJpyPer1000PerSide':'3','simulatedFinancingJpyPer1000UtcDay':'10','fxMaxAgeMs':60000,
        'engine':'nautilus-trader','engineVersion':'1.231.0','model':'native-quote-tick-v1',
        'interpretation':'informed replay of same history; not out-of-sample' if profile_id == PROFILE_IDS[1] else 'legacy continuous experiment'}
    digest = 'sha256:'+hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    if selected and selected != {'id':profile_id,'digest':digest,'content':content}:
        raise InputError('RULES_MISMATCH','Frozen profile content/digest changed')
    keys = ('engine','engineVersion','model','initialBalance','victoryBalance','fxMaxAgeMs','commissionJpyPer1000PerSide','simulatedFinancingJpyPer1000UtcDay','chapterRules')
    if any(r.get(k) != content[k] for k in keys):
        raise InputError('RULES_MISMATCH','Fixed profile, costs or FX changed')
    return rules

def decimal(value):
    import re
    if not isinstance(value, str) or not re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", value):
        raise InputError("INVALID_DATA", "Prices/amounts must be decimal strings")
    v = D(value)
    if len(v.as_tuple().digits) > 30 or abs(v.as_tuple().exponent) > 18:
        raise InputError("UNSUPPORTED_PRECISION", "Adapter supports <=30 significant digits, <=18 decimal places")
    return v

def text(value):
    s = format(value, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

def gap_allowed(chapter, before, after):
    if after-before == HOUR:
        return True
    gaps = chapter.get("weekendGaps", [])
    a = datetime.fromtimestamp(before/1000, timezone.utc)
    b = datetime.fromtimestamp(after/1000, timezone.utc)
    return any(g.get("from")==before and g.get("to")==after for g in gaps) and a.weekday()==4 and b.weekday()==6 and 48*HOUR <= after-before <= 50*HOUR

def validate_step(state, step):
    profile_rules(state)
    chapter = state["chapters"][state["chapter"]]
    if not gap_allowed(chapter, step["previousTime"], step["from"]):
        raise InputError("INVALID_DATA", "Unexpected H1 gap: exact data-module weekendGaps entry required")
    ticks = step["ticks"]
    coverage = step["coverage"]
    if coverage.get("complete") is not True or coverage.get("from") != step["from"] or coverage.get("to") != step["to"]:
        raise InputError("INVALID_DATA", "Data-module complete quote coverage for the exact interval is required")
    if coverage.get("dataKind") != "quote_ticks":
        raise InputError("UNSUPPORTED_DATA_KIND", "Native adapter accepts real bid/ask QuoteTick input only; H1/M1 OHLC is not tick data")
    if not isinstance(ticks, list) or not ticks:
        raise InputError("INVALID_DATA", "No next-interval quote ticks")
    previous = step["from"]-1
    # Derive this from authoritative pre-step exposure and the saved decision,
    # never from a caller-supplied flag. Closing an existing position needs FX.
    zero_exposure = state["position"] is None and step["decision"].get("target") == "0" and step["decision"].get("stop") is None
    for t in ticks:
        if type(t.get("time")) is not int or not (step["from"] <= t["time"] < step["to"]) or t["time"] < previous:
            raise InputError("INVALID_DATA", "Quote ticks must have nondecreasing UTC ms (stable same-ms source order) within this H1 interval")
        previous = t["time"]
        books = [t]
        if chapter["symbol"].endswith("CHF"):
            if "fx" not in t and zero_exposure:
                pass  # zero CHF PnL and zero margin need no conversion rate
            elif not isinstance(t.get("fx"), dict) or type(t["fx"].get("time")) is not int or t["fx"]["time"] > t["time"] or t["time"]-t["fx"]["time"] > state["rules"].get("fxMaxAgeMs", 60000):
                raise InputError("INVALID_DATA", "CHFJPY must be last-known as-of <= main time, age <= fixed 60000ms")
            else:
                books.append(t["fx"])
        for book in books:
            bid, ask = decimal(book.get("bid")), decimal(book.get("ask"))
            if bid <= 0 or ask < bid:
                raise InputError("INVALID_DATA", "Invalid/crossed quote")
            if coverage.get("liquidityAssumption") != "unbounded_top_of_book":
                raise InputError("UNSUPPORTED_LIQUIDITY", "Adapter requires explicit unbounded_top_of_book assumption; does not claim historic fill capacity")
    return chapter

class ChallengeFee(FeeModel):
    def get_commission(self, order, fill_qty, fill_px, instrument):
        return Money(fill_qty.as_decimal()*D("0.003"), JPY)

class ChallengeStrategy(Strategy):
    def __init__(self, state, instruments):
        super().__init__()
        self.s = state
        self.instruments = instruments
        self.context = None
        self.stop_order = None
        self.reasons = {}
        self.serial = 0
        self.open_risk = False
        self.adjusting = False
        self.error = None
        self.processed = 0
        self.trace_enabled = state['rules'].get('experimentProfile',{}).get('id') == PROFILE_IDS[1]
        self.order_meta = {}
        if self.trace_enabled:
            self.s.setdefault('nativeOrderTrace',[])

    def on_start(self):
        for instrument in self.instruments.values():
            self.subscribe_quote_ticks(instrument.id)

    def current_q(self):
        return int(self.s["position"]["quantity"]) if self.s["position"] else 0

    def instrument(self):
        return self.instruments[self.s["chapters"][self.s["chapter"]]["symbol"]]

    def conversion(self, pnl):
        if self.instrument().quote_currency.code == "JPY":
            return D("1")
        return decimal(self.context["tick"]["fx"]["bid" if pnl >= 0 else "ask"])

    def metric(self):
        q = self.current_q()
        if q == 0:
            return {"balance":self.s["balance"], "unrealizedJpy":"0", "equity":self.s["balance"], "margin":"0", "freeMargin":self.s["balance"]}
        tick = self.context["tick"]
        mark = decimal(tick["bid"] if q > 0 else tick["ask"])
        pnl = D("0")
        for lot in (self.s["position"] or {}).get("lots", []):
            part = (mark-decimal(lot["entry"]))*D(lot["quantity"])
            pnl += part*self.conversion(part)
        profile = profile_rules(self.s)[self.s["chapter"]]
        margin = D(abs(q))*decimal(tick["ask"])/D(profile["leverage"])
        if self.instrument().quote_currency.code == "CHF":
            margin *= decimal(tick["fx"]["ask"])
        equity = decimal(self.s["balance"])+pnl
        return {"balance":self.s["balance"], "unrealizedJpy":text(pnl), "equity":text(equity), "margin":text(margin), "freeMargin":text(equity-margin)}

    def trace_order(self, order, event_name, event=None):
        if not self.trace_enabled:
            return
        if order is None or self.context is None:
            raise InputError('NATIVE_TRACE_MISSING', 'Actual cached order/context required for lifecycle evidence')
        key = str(order.client_order_id)
        if key not in self.order_meta:
            if event_name != 'actual-order-factory-created':
                raise InputError('NATIVE_TRACE_MISSING', 'Unknown cached order creation/parent; never infer from a later callback')
            self.order_meta[key] = {'createdAt':self.context['tick']['time'], 'chapter':self.s['chapter'], 'parentDecisionId':self.context['decision'].get('continuationOf') or self.context['decision']['id'], 'decisionId':self.context['decision']['id']}
        meta = self.order_meta[key]
        quantity, filled = order.quantity.as_decimal(), order.filled_qty.as_decimal()
        native_status = order.status.name
        statuses = {'INITIALIZED':'pending','SUBMITTED':'pending','ACCEPTED':'working','TRIGGERED':'working','PARTIALLY_FILLED':'partially_filled','FILLED':'filled','PENDING_CANCEL':'cancel_pending','CANCELED':'cancelled','REJECTED':'rejected','DENIED':'rejected','EXPIRED':'expired','PENDING_UPDATE':'working'}
        if native_status not in statuses:
            raise InputError('NATIVE_TRACE_STATUS_UNSUPPORTED', 'Unknown actual Nautilus order status '+native_status)
        trigger = getattr(order, 'trigger_price', None)
        row = {'id':self.s['id']+':native-order-event:'+str(len(self.s['nativeOrderTrace'])+1),'nativeClientOrderId':key,'chapter':meta['chapter'],'createdAt':meta['createdAt'],'time':self.context['tick']['time'],'parentDecisionId':meta['parentDecisionId'],'decisionId':meta['decisionId'],'instrument':self.instrument().raw_symbol.value,'nativeInstrumentId':str(order.instrument_id),'side':'buy' if order.side==OrderSide.BUY else 'sell','quantity':text(quantity),'filledQuantity':text(filled),'remainingQuantity':text(quantity-filled),'status':statuses[native_status],'nativeStatus':native_status,'event':event_name,'orderType':'stop' if trigger is not None else 'market','stopPrice':text(trigger.as_decimal()) if trigger is not None else None,'reduceOnly':order.is_reduce_only,'reason':self.reasons.get(key),'nativeEventNs':str(event.ts_event) if event is not None else str(order.ts_init),'internalOrderingOnly':True,'sourceSequence':self.context['tick'].get('sourceSequence'),'engine':'nautilus-trader'}
        self.s['nativeOrderTrace'].append(row)

    def trace_event(self, event, name):
        if self.trace_enabled:
            self.trace_order(self.cache.order(event.client_order_id), name, event)

    def on_order_submitted(self,event): self.trace_event(event,'OrderSubmitted')
    def on_order_accepted(self,event): self.trace_event(event,'OrderAccepted')
    def on_order_updated(self,event): self.trace_event(event,'OrderUpdated')
    def on_order_pending_cancel(self,event): self.trace_event(event,'OrderPendingCancel')
    def on_order_canceled(self,event): self.trace_event(event,'OrderCanceled')
    def on_order_expired(self,event): self.trace_event(event,'OrderExpired')
    def on_order_triggered(self,event): self.trace_event(event,'OrderTriggered')

    def cancel_stop(self):
        if self.stop_order is not None and not self.stop_order.is_closed:
            self.cancel_order(self.stop_order)
        self.stop_order = None

    def market(self, delta, reason, reduce_only=False):
        if not delta:
            return
        self.serial += 1
        order = self.order_factory.market(self.instrument().id, OrderSide.BUY if delta > 0 else OrderSide.SELL,
            Quantity.from_str(str(abs(delta))), reduce_only=reduce_only)
        self.reasons[str(order.client_order_id)] = reason
        self.trace_order(order,'actual-order-factory-created')
        self.submit_order(order)
        if order.is_closed and order.status != OrderStatus.FILLED:
            raise InputError("NATIVE_ORDER_REJECTED", str(order))

    def install_stop(self):
        if not self.s["position"] or self.s["position"]["stop"] is None:
            return
        q = self.current_q()
        stop = self.s["position"]["stop"]
        order = self.order_factory.stop_market(self.instrument().id, OrderSide.SELL if q > 0 else OrderSide.BUY,
            Quantity.from_str(str(abs(q))), self.instrument().make_price(D(stop)), trigger_type=TriggerType.BID_ASK, reduce_only=True)
        self.reasons[str(order.client_order_id)] = "stop"
        self.stop_order = order
        self.trace_order(order,'actual-order-factory-created')
        self.submit_order(order)

    def on_order_filled(self, event):
        q = int(event.last_qty.as_decimal())*(1 if event.order_side==OrderSide.BUY else -1)
        if event.last_qty.as_decimal() != D(abs(q)):
            self.error = "Noninteger native partial fill is unsupported by this adapter"
            return
        price = event.last_px.as_decimal()
        commission = event.commission.as_decimal()
        oldq = self.current_q()
        remaining = abs(q)
        realized = D("0")
        closed = []
        if oldq and (oldq > 0) != (q > 0):
            for lot in self.s["position"]["lots"]:
                take = min(remaining, abs(int(lot["quantity"])))
                signed = take if oldq > 0 else -take
                raw = (price-decimal(lot["entry"]))*D(signed)
                rate = self.conversion(raw)
                converted = raw*rate
                closed.append({"quantity":str(signed), "entry":lot["entry"], "exit":text(price), "realizedQuote":text(raw), "conversionRate":text(rate), "conversionSymbol":"CHFJPY" if self.instrument().quote_currency.code=="CHF" else "JPY/JPY", "conversionSource":self.context["tick"].get("fx",{}).get("source"), "realizedJpy":text(converted), "conversionTimeMs":self.context["tick"].get("fx",{}).get("time"), "conversionAgeMs":(self.context["tick"]["time"]-self.context["tick"]["fx"]["time"]) if "fx" in self.context["tick"] else 0})
                realized += converted
                lot["quantity"] = str(int(lot["quantity"])-signed)
                remaining -= take
                if not remaining:
                    break
            self.s["position"]["lots"] = [lot for lot in self.s["position"]["lots"] if int(lot["quantity"])]
            if not self.s["position"]["lots"]:
                self.s["position"] = None
        if remaining:
            if not self.s["position"]:
                self.s["position"] = {"quantity":"0", "entry":text(price), "stop":None, "instrument":self.instrument().raw_symbol.value, "lots":[]}
            self.s["position"]["lots"].append({"quantity":str(remaining if q > 0 else -remaining), "entry":text(price)})
        if self.s["position"]:
            lots = self.s["position"]["lots"]
            total = sum(int(l["quantity"]) for l in lots)
            self.s["position"]["quantity"] = str(total)
            self.s["position"]["entry"] = text((sum(decimal(l["entry"])*D(abs(int(l["quantity"]))) for l in lots)/D(abs(total))).quantize(D("0.000000000000000001"),rounding=ROUND_HALF_UP))
        self.s["balance"] = text(decimal(self.s["balance"])+realized-commission)
        reason = self.reasons.get(str(event.client_order_id), "native_order")
        if reason in ("stop", "stopout") and self.context["first"]:
            self.open_risk = True
        row = {"type":"fill", "id":f'{self.s["id"]}:fill:{len(self.s["fills"])+1}', "orderId":self.context["decision"]["id"],
            "nativeClientOrderId":str(event.client_order_id), "nativeTradeId":str(event.trade_id),
            "chapter":self.s["chapter"], "index":self.s["index"]+1, "time":self.context["tick"]["time"], "nativeEventNs":str(event.ts_event), "internalOrderingOnly":True,
            "sourceSequence":self.context["tick"].get("sourceSequence"),
            "instrument":self.instrument().raw_symbol.value, "signedQuantity":str(q), "closedQuantity":str(sum(abs(int(l["quantity"])) for l in closed)),
            "openedQuantity":str(remaining), "price":text(price), "realizedJpy":text(realized), "commission":text(commission), "financing":"0",
            "closedLots":closed, "balanceAfter":self.s["balance"], "reason":reason, "mode":"quote_tick", "engine":"nautilus-trader"}
        if self.trace_enabled:
            row['parentDecisionId'] = self.order_meta[str(event.client_order_id)]['parentDecisionId']
        self.s["fills"].append(copy.deepcopy(row))
        self.s["ledger"].append(row)
        self.trace_event(event,"OrderFilled")

    def on_order_rejected(self, event):
        self.trace_event(event,"OrderRejected")
        self.error = str(event)

    def on_order_denied(self, event):
        self.trace_event(event,"OrderDenied")
        self.error = str(event)

    def finish_bankruptcy(self, force=False):
        if decimal(self.s["balance"]) > 0 and not force:
            return False
        self.cancel_stop()
        if self.current_q():
            self.market(-self.current_q(), "bankruptcy_close", True)
        self.s["bankrupt"] = True
        self.s["status"] = "complete"
        self.s["outcome"] = "bankrupt"
        if self.context["first"] and not any(o["id"]==self.context["decision"]["id"] for o in self.s["orders"]):
            self.s["orders"].append({"id":self.context["decision"]["id"],"chapter":self.s["chapter"],"index":self.s["index"]+1,"time":self.context["tick"]["time"],"target":self.context["decision"]["target"],"stop":self.context["decision"]["stop"],"status":"bankrupt","resultingQuantityAtOpen":str(self.current_q())})
        return True

    def on_quote_tick(self, tick):
        if tick.instrument_id != self.instrument().id:
            return
        self.processed += 1
        c = self.context
        self.s["lastQuote"] = copy.deepcopy(c["tick"])
        if c.get("forced_bankruptcy"):
            self.finish_bankruptcy(True)
            return
        m = self.metric()
        if self.current_q() and D(m["equity"]) <= D(m["margin"])*D(profile_rules(self.s)[self.s["chapter"]]["stopout"]):
            self.cancel_stop()
            self.market(-self.current_q(), "stopout", True)
            self.open_risk = c["first"]
        if self.finish_bankruptcy():
            return
        if c["first"]:
            account = self.cache.account_for_venue(VENUE)
            if account is not None:
                account.set_leverage(self.instrument().id,D(profile_rules(self.s)[self.s["chapter"]]["leverage"]))
            target = int(c["decision"]["target"])
            status = "risk_blocked" if self.open_risk else "held" if target==self.current_q() else "filled"
            if not self.open_risk:
                self.cancel_stop()
                q = self.current_q()
                if q and (target==0 or (q > 0)!=(target > 0)):
                    self.market(-q, "target_close", True)
                elif abs(target)<abs(q):
                    self.market(target-q, "target_reduce", True)
                if self.finish_bankruptcy():
                    return
                delta = target-self.current_q()
                if delta:
                    price = decimal(c["tick"]["ask"] if delta > 0 else c["tick"]["bid"])
                    price += self.instrument().price_increment.as_decimal()*(1 if delta > 0 else -1)
                    trial_fee = D(abs(delta))*D("0.003")
                    trial_unrealized = (decimal(c["tick"]["bid"] if target > 0 else c["tick"]["ask"])-price)*D(delta)
                    trial_unrealized *= self.conversion(trial_unrealized)
                    before = self.metric()
                    margin = D(abs(target))*decimal(c["tick"]["ask"])/D(profile_rules(self.s)[self.s["chapter"]]["leverage"])
                    if self.instrument().quote_currency.code=="CHF":
                        margin *= decimal(c["tick"]["fx"]["ask"])
                    if D(before["equity"])+trial_unrealized-trial_fee >= margin and D(before["equity"])+trial_unrealized-trial_fee > 0:
                        self.market(delta, "target_open")
                    else:
                        status = "rejected"
                if self.finish_bankruptcy():
                    return
                if self.s["position"]:
                    self.s["position"]["stop"] = c["decision"]["stop"]
                    self.install_stop()
            self.s["orders"].append({"id":c["decision"]["id"], "chapter":self.s["chapter"], "index":self.s["index"]+1,
                "time":c["tick"]["time"], "target":c["decision"]["target"], "stop":c["decision"]["stop"], "status":status,
                "rejection":"insufficient_margin" if status=="rejected" else None, "resultingQuantityAtOpen":str(self.current_q())})
        if c["final"] and self.current_q():
            self.cancel_stop()
            self.market(-self.current_q(), "chapter_end", True)
        if decimal(self.s["balance"]) <= 0:
            self.s["bankrupt"] = True
            self.s["status"] = "complete"
            self.s["outcome"] = "bankrupt"

    def charge_financing(self, before, after):
        q = self.current_q()
        days = after//DAY-before//DAY
        if not q or days <= 0:
            return
        amount = D(abs(q))*D("0.01")*days
        self.s["balance"] = text(decimal(self.s["balance"])-amount)
        self.s["ledger"].append({"type":"financing", "id":f'{self.s["id"]}:ledger:{len(self.s["ledger"])+1}',
            "chapter":self.s["chapter"], "index":self.s["index"]+1, "time":after, "from":before, "to":after, "days":days,
            "realizedJpy":"0", "commission":"0", "financing":text(amount), "balanceAfter":self.s["balance"], "simulated":True})

def instrument(symbol, chapter):
    size = chapter.get("tickSize", "0.001" if symbol.endswith("JPY") else "0.00001")
    increment = Price.from_str(size)
    return CurrencyPair(InstrumentId.from_str(symbol+".KURUMI"), Symbol(symbol), Currency.from_str(symbol[:3]), Currency.from_str(symbol[3:]),
        increment.precision, 0, increment, Quantity.from_str("1000"), 0, 0, min_quantity=Quantity.from_str("1000"),
        max_quantity=Quantity.from_str("10000000"), margin_init=D("1"), margin_maint=D("1"), maker_fee=D("0"), taker_fee=D("0"))

def native_quote(inst, book, internal_ns=None, source_event_ns=None):
    p = inst.price_precision
    bid, ask = decimal(book["bid"]), decimal(book["ask"])
    if bid % inst.price_increment.as_decimal() != 0 or ask % inst.price_increment.as_decimal() != 0:
        raise InputError("UNSUPPORTED_PRECISION", "Quote precision exceeds instrument tick precision")
    return QuoteTick(inst.id, Price.from_str(format(bid, f'.{p}f')), Price.from_str(format(ask, f'.{p}f')),
        Quantity.from_str("100000000"), Quantity.from_str("100000000"), (book["time"]*1000000 if internal_ns is None else internal_ns) if source_event_ns is None else source_event_ns, book["time"]*1000000 if internal_ns is None else internal_ns)

def hydrate(step, root):
    saved = copy.deepcopy(step)
    if "ticksRef" not in saved:
        return saved
    ref = saved["ticksRef"]
    path = pathlib.Path(ref["path"])
    base = pathlib.Path(root).resolve()/"steps"
    if path.is_symlink() or base not in path.resolve().parents:
        raise InputError("UNSAFE_PATH", "Quote file must be a regular immutable owned steps file")
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise InputError("INVALID_DATA", "Consumed immutable quote file missing; pause without automatic replay/download")
    if len(raw)>128*1024*1024 or "sha256:"+hashlib.sha256(raw).hexdigest()!=ref["digest"]:
        raise InputError("HASH_MISMATCH", "Immutable quote file hash/budget mismatch")
    saved["ticks"] = json.loads(raw)
    if not isinstance(saved["ticks"],list) or len(saved["ticks"])!=ref["rowCount"]:
        raise InputError("HASH_MISMATCH", "Immutable quote row count mismatch")
    return saved

def core_equal(a,b):
    return all(a.get(k)==b.get(k) for k in ("id","balance","position","version","chapter","index","ledger","decisions","dataDigests","nativeJournal","rules","chapters","fills","orders","history","equity","lastQuote","revealedFrameTime","bankrupt","nativeOrderTrace","nativeOrderTraceCoverage","lastPresentationTrace"))

def rebuild(request):
    global SESSION
    started = time.monotonic()
    supplied = request["state"]
    original_step = request["step"]
    step = hydrate(original_step,request.get("storageRoot",""))
    validate_step(supplied, step) # validate new data before any engine call or fee
    journal = copy.deepcopy(supplied.get("nativeJournal", []))
    journal.append(original_step)
    reused = bool(request.get("persistent") and SESSION and core_equal(SESSION["state"],supplied))
    if reused:
        engine, strategy = SESSION["engine"], SESSION["strategy"]
        s = copy.deepcopy(supplied)
        s["missingData"] = None
        strategy.s = s
        instruments = strategy.instruments
        journal = [original_step]
    else:
        if SESSION:
            SESSION["engine"].dispose()
            SESSION = None
        s = copy.deepcopy(supplied)
        s.update(balance="300000", position=None, version=1, chapter=0, index=s["chapters"][0]["startIndex"], status="paused",
            fills=[], orders=[], history=[], decisions=[], equity=[], ledger=[], nativeJournal=[], outcome=None, bankrupt=False,
            missingData=None, revealedFrameTime=None, lastQuote=None)
        if s['rules'].get('experimentProfile',{}).get('id') == PROFILE_IDS[1]:
            s['nativeOrderTrace']=[]
            s['nativeOrderTraceCoverage']=None
            s['lastPresentationTrace']=[]
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggingConfig(bypass_logging=True), risk_engine=RiskEngineConfig(bypass=True), run_analysis=False))
        instruments = {c["symbol"]:instrument(c["symbol"],c) for c in s["chapters"]}
        if any(c["symbol"].endswith("CHF") for c in s["chapters"]):
            instruments["CHFJPY"] = instrument("CHFJPY", {})
        leverages = {instruments[c["symbol"]].id:D(profile_rules(s)[i]["leverage"]) for i,c in enumerate(s["chapters"])}
        engine.add_venue(VENUE, OmsType.NETTING, AccountType.MARGIN, [Money(D("300000"),JPY)], base_currency=JPY,
            default_leverage=D("25"), leverages=leverages, fee_model=ChallengeFee(), fill_model=FillModel(prob_slippage=0.0,random_seed=0),
            reject_stop_orders=False, use_message_queue=False, bar_execution=False, trade_execution=False, frozen_account=True)
        for inst in instruments.values():
            engine.add_instrument(inst)
        strategy = ChallengeStrategy(s,instruments)
        engine.add_strategy(strategy)
    try:
        for step_index, original_saved in enumerate(journal):
            saved = hydrate(original_saved,request.get("storageRoot",""))
            if s["status"]=="complete":
                raise InputError("RUN_COMPLETE", "Cannot replay after completion/bankruptcy")
            if step_index==len(journal)-1:
                for key in ("balance","position","version","chapter","index","ledger","decisions","fills","orders","history","equity","lastQuote","revealedFrameTime","bankrupt"):
                    if s[key]!=supplied[key]:
                        raise InputError("CHECKPOINT_MISMATCH", "Native replay does not reproduce supplied checkpoint: "+key)
            c = validate_step(s,saved)
            strategy.open_risk = False
            prev = s["lastQuote"]["time"] if s["lastQuote"] and s["position"] else saved["previousTime"]+HOUR
            consumed = []
            presentation_trace = []
            record_presentation = s['rules'].get('experimentProfile',{}).get('id') == PROFILE_IDS[1]
            sample_indices = {((len(saved['ticks'])-1)*k)//7 for k in range(8)} if record_presentation else set()
            duplicate_sequence = 0
            last_source_ms = None
            for i,t in enumerate(saved["ticks"]):
                duplicate_sequence = duplicate_sequence+1 if t["time"]==last_source_ms else 0
                last_source_ms = t["time"]
                if duplicate_sequence>=1000000:
                    raise InputError("UNSUPPORTED_ORDERING","Too many events within one source millisecond")
                internal_ns = t["time"]*1000000+duplicate_sequence
                strategy.context = {"tick":t, "decision":saved["decision"], "first":i==0, "final":i==len(saved["ticks"])-1 and s["index"]+1==c["endIndex"]}
                strategy.charge_financing(prev,t["time"])
                if decimal(s["balance"]) <= 0:
                    strategy.cancel_stop()
                    strategy.context["forced_bankruptcy"] = True
                prev = t["time"]
                if "fx" in t and c["symbol"].endswith("CHF"):
                    fx_quote = native_quote(instruments["CHFJPY"],t["fx"],internal_ns,source_event_ns=t["fx"]["time"]*1000000)
                    engine.add_data([fx_quote])
                engine.add_data([native_quote(instruments[c["symbol"]],t,internal_ns)])
                engine.run(streaming=True)
                engine.clear_data()
                if strategy.error:
                    raise InputError("NATIVE_ORDER_ERROR",strategy.error)
                consumed.append(copy.deepcopy(t))
                if record_presentation and (i in sample_indices or s['bankrupt']):
                    presentation_trace.append({'sequence':i,'time':t['time'],'quote':copy.deepcopy(t),'account':strategy.metric(),'position':copy.deepcopy(s['position']),'fillCount':len(s['fills']),'orderCount':len(s['orders']),'ledgerCount':len(s['ledger']),'nativeOrderTraceCount':len(s.get('nativeOrderTrace',[])),'bankrupt':s['bankrupt']})
                if s["bankrupt"]:
                    break
            # Financing accrues between consumed actual quote timestamps only.
            s["index"] += 1
            s["version"] += 1
            s["revealedFrameTime"] = saved["from"]
            s["decisions"].append({"decision":copy.deepcopy(saved["decision"]), "executedChapter":s["chapter"], "executedIndex":s["index"],
                "executionTime":consumed[0]["time"], "resultingVersion":s["version"]})
            s["equity"].append({"chapter":s["chapter"],"index":s["index"],"time":consumed[-1]["time"], **strategy.metric(), "quantity":str(strategy.current_q())})
            s["history"].append({"type":"native_step", "chapter":s["chapter"], "index":s["index"], "balance":s["balance"], "processedQuotes":len(consumed), "intervalComplete":not s["bankrupt"]})
            recorded = copy.deepcopy(original_saved)
            if "ticksRef" not in recorded or s["bankrupt"]:
                recorded.pop("ticksRef",None)
                recorded["ticks"] = consumed # terminal checkpoint never retains unconsumed future quotes
            s["nativeJournal"].append(recorded)
            if record_presentation:
                s['lastPresentationTrace'] = presentation_trace
            s["lastConsumedInterval"] = {"chapter":s["chapter"],"index":s["index"],"from":saved["from"],"toExclusive":saved["to"],"lastTime":consumed[-1]["time"],"complete":not s["bankrupt"],"rowCount":len(consumed)}
            if record_presentation:
                s['nativeOrderTraceCoverage']={'abi':'kurumi.native-order-trace@1','complete':True,'engineVersion':s['version'],'asOfMs':saved['to'] if not s['bankrupt'] else consumed[-1]['time'],'actualQuoteTimeMs':consumed[-1]['time'],'eventCount':len(s['nativeOrderTrace']),'source':'actual Nautilus order factory + lifecycle callbacks; not inferred from fills'}
            if s["bankrupt"]:
                break
            s["status"] = "paused"
            if s["index"]==c["endIndex"]:
                s["history"].append({"type":"chapter_end", "chapter":s["chapter"], "index":s["index"], "time":consumed[-1]["time"], "balance":s["balance"]})
                if s["chapter"]==2:
                    s["status"] = "complete"
                    s["outcome"] = "victory" if decimal(s["balance"])>=D("20000000") else "not_reached"
                else:
                    s["chapter"] += 1
                    s["index"] = s["chapters"][s["chapter"]]["startIndex"]
                    s["revealedFrameTime"] = None
                    s["lastQuote"] = None
                    strategy.stop_order = None
        s["nativeReceipt"] = {"engine":"nautilus-trader", "version":nautilus_trader.__version__, "matching":"QuoteTick/L1/BID_ASK STOP_MARKET",
            "barExecution":False, "replayedSteps":len(s["nativeJournal"]), "processedQuotes":strategy.processed,
            "cacheReused":reused,"replayedStepsThisCall":0 if reused else len(journal)-1,"elapsedMs":int((time.monotonic()-started)*1000),
            "fxPolicy":"last-known bid/ask <= event UTC ms; max age 60000ms", "sourceTimePrecision":"milliseconds", "sameMsOrdering":"stable source order, internal ns sequence only",
            "accountCurrency":"JPY", "nativeAccountFrozen":True, "nativeFrozenBalanceJpy":text(engine.cache.account_for_venue(VENUE).balance_total(JPY).as_decimal()), "authoritativeBalance":"exact challenge ledger", "liquidityAssumption":"unbounded_top_of_book","experimentProfile":s["rules"].get("experimentProfile"),"chapterRules":profile_rules(s)}
        balance = D("300000")
        for row in s["ledger"]:
            balance += decimal(row["realizedJpy"])-decimal(row["commission"])-decimal(row["financing"])
            if balance != decimal(row["balanceAfter"]):
                raise InputError("LEDGER_MISMATCH", "Native adapter running balance does not reconcile")
        if balance != decimal(s["balance"]):
            raise InputError("LEDGER_MISMATCH", "Final exact balance mismatch")
        if request.get("persistent"):
            SESSION = {"engine":engine,"strategy":strategy,"state":s}
        return s
    except Exception:
        SESSION = None
        engine.dispose()
        raise
    finally:
        if not request.get("persistent"):
            engine.dispose()

if __name__=="__main__":
    def respond(request):
        try:
            with localcontext() as ctx:
                ctx.prec = 100
                result = rebuild(request)
            print(json.dumps({"ok":True,"state":result},ensure_ascii=False),flush=True)
        except Exception as e:
            print(json.dumps({"ok":False,"code":getattr(e,"code","NATIVE_FAILURE"),"message":str(e)},ensure_ascii=False),flush=True)
            if "--worker" not in sys.argv:
                sys.exit(1)
    if "--worker" in sys.argv:
        for line in sys.stdin:
            if line.strip():
                respond(json.loads(line))
        if SESSION:
            SESSION["engine"].dispose()
    else:
        respond(json.load(sys.stdin))
