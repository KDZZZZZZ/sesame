"""Opt-in real pinned engine tests; no substitute vn.py classes or dummy data providers."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1] / 'packages' / 'vnpy'
PYTHON = os.environ.get('SESAME_VNPY_PYTHON')


@unittest.skipUnless(PYTHON, 'Set SESAME_VNPY_PYTHON to the actual compatible environment')
class ActualEngine(unittest.TestCase):
    def run_case(self, mutate=None, strategy=None):
        request = json.loads((PACKAGE / 'examples' / 'bars.json').read_text())
        if mutate:
            mutate(request)
        with tempfile.TemporaryDirectory(prefix='sesame-vnpy-engine-') as directory:
            root = Path(directory)
            (root / 'strategy.py').write_text(strategy or (PACKAGE / 'examples' / 'strategy.py').read_text())
            request.update(strategy_path=str(root / 'strategy.py'), class_name='ExampleStrategy')
            (root / 'request.json').write_text(json.dumps(request))
            process = subprocess.run([PYTHON, '-I', '-B', str(PACKAGE / 'runner.py'), str(root / 'request.json'), str(root / 'result.json')], cwd=root, capture_output=True, text=True, timeout=30)
            result = json.loads((root / 'result.json').read_text())
            self.assertEqual(process.returncode == 0, result['status'] == 'completed', process.stderr)
            return result

    def test_actual_matching_and_nested_daily_trades_serialize(self):
        result = self.run_case()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['statistics']['total_net_pnl'], '4.791')
        self.assertEqual([trade['price'] for trade in result['trades']], ['102.0', '107.0'])
        self.assertEqual(result['engine']['vnpy_ctastrategy'], '1.4.1')
        self.assertTrue(any(row['trades'] for row in result['daily']))

    def test_strategy_exception_is_failure_not_partial_success(self):
        result = self.run_case(strategy='from vnpy_ctastrategy import CtaTemplate\nclass ExampleStrategy(CtaTemplate):\n def on_init(self): pass\n def on_bar(self, bar): raise RuntimeError("explicit failure")\n')
        self.assertEqual(result['status'], 'failed')
        self.assertIn('explicit failure', result['error']['message'])

    def test_zero_trades_is_an_actual_completed_backtest(self):
        result = self.run_case(strategy='from vnpy_ctastrategy import CtaTemplate\nclass ExampleStrategy(CtaTemplate):\n def on_init(self): pass\n')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['processedBars'], 4)
        self.assertEqual(result['trades'], [])
        self.assertEqual(result['statistics']['total_trade_count'], 0)

    def test_duplicate_missing_and_inconsistent_bars_fail(self):
        for key, value in [('datetime', '2024-01-01T00:00:00+00:00'), ('volume', None), ('high', '0')]:
            with self.subTest(key=key):
                result = self.run_case(lambda request: request['rows'][1].__setitem__(key, value))
                self.assertEqual(result['status'], 'failed')

    def test_warmup_uses_only_supplied_fixed_history(self):
        strategy = 'from vnpy_ctastrategy import CtaTemplate\nfrom vnpy.trader.constant import Interval\nclass ExampleStrategy(CtaTemplate):\n def on_init(self): self.load_bar(2, Interval.DAILY)\n'
        result = self.run_case(strategy=strategy)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('warmup', result['error']['message'])
        result = self.run_case(lambda request: request['config'].__setitem__('start', '2024-01-03T00:00:00+00:00'), strategy)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['processedBars'], 2)

    def test_unknown_strategy_parameters_are_not_silently_ignored(self):
        result = self.run_case(lambda request: request.__setitem__('parameters', {'ignored_typo': 10}))
        self.assertEqual(result['status'], 'failed')
        self.assertIn('parameter', result['error']['message'])


if __name__ == '__main__':
    unittest.main()
