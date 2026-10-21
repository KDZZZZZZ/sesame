"""Offline CPython C-call fixture; never imports the MetaTrader5 SDK."""
import ast
import ctypes
import datetime
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

WORKER = Path(__file__).resolve().parents[1] / "backend/python-worker.py"
TREE = ast.parse(WORKER.read_text(encoding="utf-8"))


class MethodDef(ctypes.Structure):
    _fields_ = [("ml_name", ctypes.c_char_p), ("ml_meth", ctypes.c_void_p),
                ("ml_flags", ctypes.c_int), ("ml_doc", ctypes.c_char_p)]


CALLBACK = ctypes.PYFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
new_function = ctypes.pythonapi.PyCFunction_NewEx
new_function.argtypes = [ctypes.POINTER(MethodDef), ctypes.py_object, ctypes.c_void_p]
new_function.restype = ctypes.py_object
incref = ctypes.pythonapi.Py_IncRef
incref.argtypes = [ctypes.py_object]
incref.restype = None


class WorkerDispatch(unittest.TestCase):
    def setUp(self):
        self.calls, self.keep_alive, self.responses = [], [], {}
        self.mt5 = SimpleNamespace(TRADE_ACTION_DEAL=1, TRADE_ACTION_PENDING=5, TRADE_ACTION_MODIFY=7,
                                   ORDER_TYPE_BUY=0, ORDER_TYPE_SELL=1, ORDER_TYPE_BUY_LIMIT=2,
                                   ORDER_TYPE_SELL_LIMIT=3, ORDER_FILLING_IOC=1, ORDER_FILLING_RETURN=2,
                                   ORDER_TIME_GTC=0)
        for name in ("order_check", "order_send", "orders_get", "version", "history_orders_get", "symbol_info_tick"):
            @CALLBACK
            def invoke(_self, args_pointer, kwargs_pointer, name=name):
                args = ctypes.cast(args_pointer, ctypes.py_object).value
                kwargs = ctypes.cast(kwargs_pointer, ctypes.py_object).value if kwargs_pointer else None
                self.calls.append((name, args, kwargs))
                invalid_double = name in {"order_check", "order_send"} and args and any(
                    key in args[0] and type(args[0][key]) is not float
                    for key in ("volume", "price", "stoplimit", "sl", "tp"))
                result = None if args and kwargs == {} or invalid_double else self.responses.get(name, {"fixture": True})
                incref(result)
                return id(result)
            definition = MethodDef(name.encode(), ctypes.cast(invoke, ctypes.c_void_p).value, 3, b"offline fixture")
            function = new_function(ctypes.byref(definition), None, None)
            self.keep_alive.extend((invoke, definition, function))
            setattr(self.mt5, name, function)
        declarations = [node for node in TREE.body if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Name) and target.id in {"POSITIONAL", "IDS", "ENUMS", "REQUEST_DOUBLES"} for target in node.targets)]
        converter = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "convert_input")
        identity = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "quote_account_identity")
        self.mt5.account_info = lambda: SimpleNamespace(login=42, server="FTMO-Demo")
        self.mt5.last_error = lambda: (4, "tick-specific-status")
        self.scope = {"mt5": self.mt5, "datetime": datetime,
                      "_quote_clock": SimpleNamespace(resolve_quote_clock=lambda *args: {"status": "unverified"})}
        exec(compile(ast.Module(body=[*declarations, converter, identity], type_ignores=[]), str(WORKER), "exec"), self.scope)
        # Execute the worker's actual normal dispatch block, including its conditional.
        branch = next(node for node in ast.walk(TREE) if isinstance(node, ast.If)
                      and ast.unparse(node.test) == "name == 'initialize'")
        while len(branch.orelse) == 1 and isinstance(branch.orelse[0], ast.If):
            branch = branch.orelse[0]
        self.dispatch_code = compile(ast.Module(body=branch.orelse, type_ignores=[]), str(WORKER), "exec")
        tick_branch = next(node for node in ast.walk(TREE) if isinstance(node, ast.If)
                           and ast.unparse(node.test) == "name == 'symbol_info_tick'")
        self.tick_dispatch_code = compile(ast.Module(body=tick_branch.body, type_ignores=[]), str(WORKER), "exec")
        guard_branch = next(node for node in ast.walk(TREE) if isinstance(node, ast.If)
                            and ast.unparse(node.test) == "name == 'order_send' and execution_guard is not None")
        self.guard_dispatch_code = compile(ast.Module(body=guard_branch.body, type_ignores=[]), str(WORKER), "exec")

    def dispatch(self, name, arguments):
        scope = {**self.scope, "name": name, "args": self.scope["convert_input"](arguments)}
        before = len(self.calls)
        exec(self.tick_dispatch_code if name == "symbol_info_tick" else self.dispatch_code, scope)
        self.assertEqual(len(self.calls), before + 1, "never replay a native call")
        return scope["result"], self.calls[-1]

    def test_request_is_positional_without_empty_kwargs(self):
        for name in ("order_check", "order_send"):
            result, (_, args, kwargs) = self.dispatch(name, {"request": {
                "action": "TRADE_ACTION_DEAL", "type": "ORDER_TYPE_BUY", "type_filling": "ORDER_FILLING_IOC", "volume": 0.01}})
            self.assertIsNone(kwargs, "C extension must receive NULL kwargs, not **{}")
            self.assertEqual(args, ({"action": 1, "type": 0, "type_filling": 1, "volume": 0.01},))
            self.assertEqual(result, {"fixture": True})

    def test_order_check_converts_only_native_request_double_integers(self):
        request = {"action": "TRADE_ACTION_PENDING", "type": "ORDER_TYPE_BUY_LIMIT", "symbol": "USDJPY",
                   "volume": 1, "price": 157, "stoplimit": 0, "sl": 156, "tp": 158,
                   "type_time": "ORDER_TIME_GTC", "type_filling": "ORDER_FILLING_RETURN", "deviation": 2,
                   "expiration": 1792575200, "order": "9007199254740993", "position": "9007199254740995",
                   "position_by": "9007199254740997", "magic": "9007199254740999"}
        result, (_, args, kwargs) = self.dispatch("order_check", {"request": request})
        self.assertEqual(result, {"fixture": True}); self.assertIsNone(kwargs)
        native = args[0]
        for key in ("volume", "price", "stoplimit", "sl", "tp"):
            self.assertIs(type(native[key]), float); self.assertEqual(native[key], request[key])
        for key in ("action", "type", "type_time", "type_filling", "deviation", "expiration", "order", "position", "position_by", "magic"):
            self.assertIs(type(native[key]), int)
        for key in ("order", "position", "position_by", "magic"):
            self.assertEqual(native[key], int(request[key]))
        self.assertIs(type(request["price"]), int)

    def test_modify_integer_price_and_zero_protection_keep_exact_integer_ticket_and_action(self):
        request = {"action": 7, "order": 9007199254740993, "price": 157, "sl": 0, "tp": 158,
                   "type_time": 0, "expiration": 0}
        result, (_, args, _) = self.dispatch("order_send", {"request": request})
        self.assertEqual(result, {"fixture": True})
        self.assertEqual(set(args[0]), set(request))
        for key in ("price", "sl", "tp"):
            self.assertIs(type(args[0][key]), float); self.assertEqual(args[0][key], request[key])
        for key in ("order", "action", "type_time", "expiration"):
            self.assertIs(type(args[0][key]), int); self.assertEqual(args[0][key], request[key])

    def test_fractional_values_and_non_request_data_are_not_normalized(self):
        request = {"volume": 0.01, "price": 157.001, "stoplimit": 0.0, "sl": 156.701, "tp": 157.301}
        result, (_, args, _) = self.dispatch("order_check", {"request": request})
        self.assertEqual(result, {"fixture": True}); self.assertEqual(args[0], request)
        value = {"price": 157, "volume": 1, "tick": {"price": 157, "time_msc": 1792580613908}, "count": 5}
        converted = self.scope["convert_input"](value)
        self.assertEqual(converted, value)
        self.assertIs(type(converted["price"]), int); self.assertIs(type(converted["tick"]["price"]), int)

    def test_invalid_request_numeric_types_are_not_coerced_into_orders(self):
        for value in (True, None, "157"):
            with self.subTest(value=value):
                result, (_, args, _) = self.dispatch("order_check", {"request": {"price": value}})
                self.assertIsNone(result); self.assertIs(args[0]["price"], value)

    def test_inexact_integer_request_double_is_rejected_before_sdk_call(self):
        with self.assertRaisesRegex(ValueError, "exactly representable"):
            self.dispatch("order_check", {"request": {"price": 9007199254740993}})
        self.assertEqual(self.calls, [])

    def test_guarded_pending_sends_unchanged_integer_price_as_double_once(self):
        spec = importlib.util.spec_from_file_location("numeric_fixture_guard", WORKER.with_name("execution_guard.py"))
        guard_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard_module)
        now = 1792575200000
        self.mt5.account_info = lambda: SimpleNamespace(login=42, server="FTMO-Demo", trade_allowed=True, trade_expert=True)
        self.mt5.terminal_info = lambda: SimpleNamespace(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.mt5.symbol_info = lambda symbol: SimpleNamespace(volume_min=0.01, volume_max=10, volume_step=0.01)
        self.responses.update(order_check=SimpleNamespace(retcode=0), order_send=SimpleNamespace(retcode=10008, order=123),
                              symbol_info_tick=SimpleNamespace(time_msc=now + 10800000, ask=158, bid=157.9))
        guard = {"observed_at": now, "expires_at": now + 60000, "max_quote_age_ms": 5000,
                 "max_quote_to_send_ms": 1000, "price_limit": "159", "side": "buy", "expected_account": "42",
                 "expected_server": "FTMO-Demo", "quote_clock_revision": "ftmo-demo-current-tick-2026-v1"}
        request = {"action": "TRADE_ACTION_PENDING", "type": "ORDER_TYPE_BUY_LIMIT", "symbol": "USDJPY",
                   "volume": 1, "price": 157, "stoplimit": 0, "sl": 156, "tp": 158,
                   "type_filling": "ORDER_FILLING_RETURN", "type_time": "ORDER_TIME_GTC"}
        scope = {**self.scope, "args": self.scope["convert_input"]({"request": request}), "execution_guard": guard,
                 "_guard": SimpleNamespace(guarded_send=lambda *args: guard_module.guarded_send(
                     *args, clock=lambda: now, monotonic=lambda: now / 1000))}
        exec(self.guard_dispatch_code, scope)
        self.assertEqual(scope["result"].order, 123)
        writes = [call for call in self.calls if call[0] in {"order_check", "order_send"}]
        self.assertEqual([call[0] for call in writes], ["order_check", "order_send"])
        self.assertEqual(writes[0][1][0], writes[1][1][0])
        for _, args, kwargs in writes:
            self.assertIsNone(kwargs)
            for key in ("volume", "price", "stoplimit", "sl", "tp"):
                self.assertIs(type(args[0][key]), float); self.assertEqual(args[0][key], request[key])

    def test_nonempty_kwargs_and_mixed_arguments_survive(self):
        _, (_, args, kwargs) = self.dispatch("orders_get", {"symbol": "EURUSD"})
        self.assertEqual(args, ())
        self.assertEqual(kwargs, {"symbol": "EURUSD"})
        _, (_, args, kwargs) = self.dispatch("history_orders_get", {
            "date_from": "2026-10-20T00:00:00Z", "date_to": "2026-10-21T00:00:00Z", "group": "EUR*"})
        self.assertEqual(len(args), 2)
        self.assertEqual(args[0].tzinfo, datetime.timezone.utc)
        self.assertEqual(kwargs, {"group": "EUR*"})

    def test_no_argument_method_omits_empty_kwargs(self):
        _, (_, args, kwargs) = self.dispatch("version", {})
        self.assertEqual(args, ())
        self.assertIsNone(kwargs)

    def test_clock_side_reads_preserve_single_c_tick_call_with_null_kwargs(self):
        result, (_, args, kwargs) = self.dispatch("symbol_info_tick", {"symbol": "EURUSD"})
        self.assertEqual(result, {"fixture": True})
        self.assertEqual(args, ("EURUSD",))
        self.assertIsNone(kwargs)

    def test_invalid_enum_never_reaches_sdk(self):
        with self.assertRaisesRegex(ValueError, "Unknown MT5 enum"):
            self.dispatch("order_check", {"request": {"action": "TRADE_ACTION_INVALID"}})
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
