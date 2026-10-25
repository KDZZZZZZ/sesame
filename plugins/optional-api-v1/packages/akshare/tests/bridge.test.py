import io
import json
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import patch


class BridgeEncodingTest(unittest.TestCase):
    def invoke(self, failure=False):
        class Frame:
            def __len__(self):
                return 1

            def to_dict(self, orient):
                return [{'code': '600519', 'name': '\u8d35\u5dde\u8305\u53f0'}]

        def query():
            if failure:
                raise ValueError('\u6d4b\u8bd5\u4e0a\u6e38\u9519\u8bef')
            return Frame()

        ak = types.SimpleNamespace(__version__='1.19.1', stock_zh_a_spot_tx=query)
        requests = types.SimpleNamespace(sessions=types.SimpleNamespace(Session=type('Session', (), {'request': lambda *args, **kwargs: None})))
        raw = io.BytesIO()
        # Windows redirected standard output can use a Western code page even
        # when market names and upstream errors contain Chinese text.
        output = io.TextIOWrapper(raw, encoding='cp1252')
        with patch.dict(sys.modules, akshare=ak, requests=requests), patch.object(sys, 'stdin', io.StringIO('{"interface":"stock_zh_a_spot_tx"}')), patch.object(sys, 'stdout', output):
            runpy.run_path(str(Path(__file__).resolve().parents[1] / 'bridge.py'))
        output.flush()
        return json.loads(raw.getvalue())

    def test_chinese_market_names_survive_redirected_windows_pipe(self):
        result = self.invoke()
        self.assertTrue(result['ok'])
        self.assertEqual(result['rows'][0]['name'], '\u8d35\u5dde\u8305\u53f0')

    def test_chinese_upstream_error_remains_structured(self):
        result = self.invoke(failure=True)
        self.assertFalse(result['ok'])
        self.assertIn('\u6d4b\u8bd5\u4e0a\u6e38\u9519\u8bef', result['error'])


if __name__ == '__main__':
    unittest.main()
