"""Offline CPython C-call fixture; never imports the MetaTrader5 SDK."""
import ast
import ctypes
import datetime
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
        self.calls, self.keep_alive = [], []
        self.mt5 = SimpleNamespace(TRADE_ACTION_DEAL=1, ORDER_TYPE_BUY=0, ORDER_FILLING_IOC=1)
        for name in ("order_check", "order_send", "orders_get", "version", "history_orders_get"):
            @CALLBACK
            def invoke(_self, args_pointer, kwargs_pointer, name=name):
                args = ctypes.cast(args_pointer, ctypes.py_object).value
                kwargs = ctypes.cast(kwargs_pointer, ctypes.py_object).value if kwargs_pointer else None
                self.calls.append((name, args, kwargs))
                result = None if args and kwargs == {} else {"fixture": True}
                incref(result)
                return id(result)
            definition = MethodDef(name.encode(), ctypes.cast(invoke, ctypes.c_void_p).value, 3, b"offline fixture")
            function = new_function(ctypes.byref(definition), None, None)
            self.keep_alive.extend((invoke, definition, function))
            setattr(self.mt5, name, function)
        declarations = [node for node in TREE.body if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Name) and target.id in {"POSITIONAL", "IDS", "ENUMS"} for target in node.targets)]
        converter = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "convert_input")
        self.scope = {"mt5": self.mt5, "datetime": datetime}
        exec(compile(ast.Module(body=[*declarations, converter], type_ignores=[]), str(WORKER), "exec"), self.scope)
        # Execute the worker's actual normal dispatch block, including its conditional.
        branch = next(node for node in ast.walk(TREE) if isinstance(node, ast.If)
                      and ast.unparse(node.test) == "name == 'initialize'")
        while len(branch.orelse) == 1 and isinstance(branch.orelse[0], ast.If):
            branch = branch.orelse[0]
        self.dispatch_code = compile(ast.Module(body=branch.orelse, type_ignores=[]), str(WORKER), "exec")

    def dispatch(self, name, arguments):
        scope = {**self.scope, "name": name, "args": self.scope["convert_input"](arguments)}
        before = len(self.calls)
        exec(self.dispatch_code, scope)
        self.assertEqual(len(self.calls), before + 1, "never replay a native call")
        return scope["result"], self.calls[-1]

    def test_request_is_positional_without_empty_kwargs(self):
        for name in ("order_check", "order_send"):
            result, (_, args, kwargs) = self.dispatch(name, {"request": {
                "action": "TRADE_ACTION_DEAL", "type": "ORDER_TYPE_BUY", "type_filling": "ORDER_FILLING_IOC", "volume": 0.01}})
            self.assertIsNone(kwargs, "C extension must receive NULL kwargs, not **{}")
            self.assertEqual(args, ({"action": 1, "type": 0, "type_filling": 1, "volume": 0.01},))
            self.assertEqual(result, {"fixture": True})

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

    def test_invalid_enum_never_reaches_sdk(self):
        with self.assertRaisesRegex(ValueError, "Unknown MT5 enum"):
            self.dispatch("order_check", {"request": {"action": "TRADE_ACTION_INVALID"}})
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
