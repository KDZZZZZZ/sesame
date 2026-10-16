"""Fixed-source transport tests. No installed CCXT, external network or user data."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Exchange:
    def __init__(self, name, settings):
        self.id, self.settings = name, settings
        self.has, self.timeframes = {'fetchOHLCV': True}, {'1m': '1m', '1h': '1h'}
        self.precisionMode = 4
        self.markets = None
        self.loads, self.closed, self.fetches = 0, False, []

    def load_markets(self, reload=False):
        if self.markets is None or reload:
            self.loads += 1
            self.markets = {symbol: {'id': symbol, 'symbol': symbol, 'spot': True, 'active': True,
                                      'base': symbol.split('/')[0], 'quote': 'USD', 'precision': {'price': 0.01}}
                            for symbol in ['BTC/USD', 'ETH/USD']}
        return self.markets

    def market(self, symbol):
        return self.markets[symbol]

    def fetch_ohlcv(self, symbol, timeframe, since, limit):
        self.fetches.append((symbol, timeframe, since, limit))
        if since == -1:
            raise RuntimeError('controlled temporary network failure')
        return [[since, 10.0, 11.0, 9.0, 10.5, 2.0]]

    def close(self):
        self.closed = True


instances = []


def factory(name):
    def create(settings):
        exchange = Exchange(name, settings)
        instances.append(exchange)
        return exchange
    return create


sys.modules['ccxt'] = types.SimpleNamespace(__version__='4.5.85', **{
    name: factory(name) for name in ['kraken', 'coinbase', 'okx']
})
spec = importlib.util.spec_from_file_location('ccxt_bridge', Path(__file__).parents[1] / 'packages/ccxt/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def bars(**fields):
    return dict(exchange='coinbase', action='bars', symbol='BTC/USD', timeframe='1h', since=0, limit=300, **fields)


class PublicBridgeTests(unittest.TestCase):
    def test_reuse_session_markets_rate_limiter_and_native_limit(self):
        session = bridge.PublicSession()
        first = session.read(bars())
        second = session.read({**bars(), 'symbol': 'ETH/USD', 'limit': 3})
        self.assertEqual(first['sessionId'], second['sessionId'])
        self.assertEqual(second['requestNumber'], 2)
        self.assertEqual(session.exchange.loads, 1)
        self.assertTrue(session.exchange.settings['enableRateLimit'])
        self.assertEqual(session.exchange.fetches[-1], ('ETH/USD', '1h', 0, 3))
        self.assertEqual(second['rows'][0][4], '10.5')
        session.markets_at -= 301
        session.read(bars())
        self.assertEqual(session.exchange.loads, 2)
        session.close()
        self.assertTrue(session.exchange.closed)

    def test_failed_request_does_not_end_jsonl_service(self):
        requests = [bars(), {**bars(), 'since': -1}, {**bars(), 'symbol': 'ETH/USD'}]
        incoming = io.StringIO(''.join(json.dumps({'id': str(i), 'payload': p}) + '\n' for i, p in enumerate(requests)))
        outgoing = io.StringIO()
        with patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
            bridge.main()
        responses = [json.loads(line) for line in outgoing.getvalue().splitlines()]
        self.assertEqual(responses[1]['error']['code'], 'SOURCE_UNAVAILABLE')
        self.assertEqual(responses[0]['result']['sessionId'], responses[2]['result']['sessionId'])
        self.assertEqual(responses[2]['result']['requestNumber'], 2)
        self.assertTrue(instances[-1].closed)

    def test_no_private_operations_credentials_or_route_changes(self):
        session = bridge.PublicSession()
        for changed in [
            {'action': 'create_order'}, {'apiKey': 'forbidden'}, {'secret': 'forbidden'},
            {'publicProxy': 'http://username:password@localhost:7897'},
            {'publicProxy': 'http://localhost:7897/path'}, {'limit': 500}, {'since': True},
        ]:
            with self.assertRaises(bridge.RequestError):
                session.read({**bars(), **changed})
        session.read(bars())
        with self.assertRaisesRegex(bridge.RequestError, 'route cannot change'):
            session.read({**bars(), 'publicProxy': 'http://localhost:7897'})
        with self.assertRaisesRegex(bridge.RequestError, 'route cannot change'):
            session.read({**bars(), 'exchange': 'kraken'})
        session.close()


if __name__ == '__main__':
    unittest.main()
