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


class RateLimitExceeded(Exception):
    pass


class DDoSProtection(Exception):
    pass


class PermissionDenied(Exception):
    pass


class RequestTimeout(Exception):
    pass


class NetworkError(Exception):
    pass


def factory(name):
    def create(settings):
        exchange = Exchange(name, settings)
        instances.append(exchange)
        return exchange
    return create


sys.modules['ccxt'] = types.SimpleNamespace(__version__='4.5.85',
    RateLimitExceeded=RateLimitExceeded, DDoSProtection=DDoSProtection, PermissionDenied=PermissionDenied,
    RequestTimeout=RequestTimeout, NetworkError=NetworkError, **{
    name: factory(name) for name in ['kraken', 'coinbase', 'okx']
})
spec = importlib.util.spec_from_file_location('ccxt_bridge', Path(__file__).parents[1] / 'packages/ccxt/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def bars(**fields):
    return dict(exchange='coinbase', action='bars', symbol='BTC/USD', timeframe='1h', since=0, limit=300, **fields)


class PublicBridgeTests(unittest.TestCase):
    def test_kraken_directory_symbols_and_history_share_one_native_limiter(self):
        session = bridge.PublicSession()
        before = len(instances)
        directory = session.read({'exchange': 'kraken', 'action': 'markets'})
        exchange = session.exchange
        first = session.read({**bars(), 'exchange': 'kraken', 'limit': 500})
        second = session.read({**bars(), 'exchange': 'kraken', 'symbol': 'ETH/USD', 'limit': 3})
        self.assertEqual(len(instances), before + 1)
        self.assertIs(session.exchange, exchange)
        self.assertNotIn('rateLimit', exchange.settings)
        self.assertTrue(exchange.settings['enableRateLimit'])
        self.assertEqual(exchange.loads, 1)
        self.assertEqual(exchange.fetches, [('BTC/USD', '1h', 0, 500), ('ETH/USD', '1h', 0, 3)])
        self.assertEqual(directory['sessionId'], first['sessionId'])
        self.assertEqual(first['sessionId'], second['sessionId'])
        self.assertEqual(second['requestNumber'], 3)
        session.close()

    def test_all_exchanges_keep_their_native_rate_limits(self):
        for name in ['kraken', 'coinbase', 'okx']:
            with self.subTest(exchange=name):
                session = bridge.PublicSession()
                session.read({**bars(), 'exchange': name})
                self.assertNotIn('rateLimit', session.exchange.settings)
                self.assertTrue(session.exchange.settings['enableRateLimit'])
                session.close()

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

    def test_rate_limit_diagnostics_keep_the_jsonl_service_and_next_request_usable(self):
        cases = [RateLimitExceeded('coinbase native rate limit')]
        cases.extend(DDoSProtection('kraken ' + json.dumps({'error': [code]})) for code in [
            'EGeneral:Too many requests', 'EAPI:Rate limit exceeded', 'EOrder:Rate limit exceeded',
        ])
        for failure in cases:
            with self.subTest(failure=str(failure)):
                incoming = io.StringIO(''.join(json.dumps({'id': str(i), 'payload': bars()}) + '\n' for i in range(2)))
                outgoing = io.StringIO()
                with patch.object(bridge.PublicSession, 'read', side_effect=[failure, {'rows': []}]), \
                        patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
                    bridge.main()
                responses = [json.loads(line) for line in outgoing.getvalue().splitlines()]
                self.assertEqual(responses, [
                    {'id': '0', 'error': {'code': 'RATE_LIMITED', 'message': f'[{type(failure).__name__}] {failure}',
                                         'details': {'exceptionType': type(failure).__name__, 'causeTypes': []}}},
                    {'id': '1', 'result': {'rows': []}},
                ])

    def test_other_failures_are_not_reclassified_as_rate_limits(self):
        message = 'kraken {"error":["EGeneral:Too many requests"]}'
        failures = [
            DDoSProtection('kraken {"error":["EGeneral:Temporary lockout"]}'),
            DDoSProtection('kraken access denied: Too many requests'),
            DDoSProtection('coinbase {"error":["EGeneral:Too many requests"]}'),
            DDoSProtection('kraken {"error":["EGeneral:Too many requests","EGeneral:Permission denied"]}'),
            DDoSProtection('kraken {"error":"EGeneral:Too many requests"}'),
            DDoSProtection('kraken {"error":[]}'),
            DDoSProtection('kraken {"error":[{}]}'),
            DDoSProtection('kraken {invalid JSON}'),
            PermissionDenied(message),
            RuntimeError(message),
            bridge.RequestError('Invalid fixed input', 'INVALID_ARGUMENT'),
            RateLimitExceeded('limited via https://fixture-user:fixture-password@localhost/'),
        ]
        incoming = io.StringIO(''.join(json.dumps({'id': str(i), 'payload': bars()}) + '\n' for i in range(len(failures))))
        outgoing = io.StringIO()
        with patch.object(bridge.PublicSession, 'read', side_effect=failures), \
                patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
            bridge.main()
        responses = [json.loads(line) for line in outgoing.getvalue().splitlines()]
        self.assertEqual([row['error']['code'] for row in responses],
                         ['SOURCE_UNAVAILABLE'] * 10 + ['INVALID_ARGUMENT', 'RATE_LIMITED'])
        self.assertEqual(responses[-1]['error']['message'], '[RateLimitExceeded] limited via https://[redacted]@localhost/')

    def test_timeout_and_network_errors_keep_actual_types_without_inventing_http_status(self):
        failures = [RequestTimeout('okx GET https://www.okx.com/api/v5/public/instruments?instType=SPOT'),
                    NetworkError('kraken GET https://api.kraken.com/0/public/Assets'),
                    PermissionDenied('coinbase GET https://api.coinbase.com/v2/currencies')]
        incoming = io.StringIO(''.join(json.dumps({'id': str(i), 'payload': bars()}) + '\n' for i in range(len(failures))))
        outgoing = io.StringIO()
        with patch.object(bridge.PublicSession, 'read', side_effect=failures), \
                patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
            bridge.main()
        errors = [json.loads(line)['error'] for line in outgoing.getvalue().splitlines()]
        self.assertEqual([error['code'] for error in errors], ['TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_UNAVAILABLE'])
        for error, failure in zip(errors, failures):
            self.assertEqual(error['details'], {'exceptionType': type(failure).__name__, 'causeTypes': []})
            self.assertEqual(error['message'], f'[{type(failure).__name__}] {failure}')

    def test_cause_types_are_bounded_and_real_http_status_is_preserved(self):
        failure = NetworkError('failed via https://fixture-user:fixture-secret@localhost/endpoint')
        failure.response = types.SimpleNamespace(status_code=502)
        chain = [TimeoutError('cause secret must not be copied'), ConnectionError('closed'), RuntimeError('upstream'), ValueError('limit'), OSError('omitted')]
        failure.__cause__ = chain[0]
        for current, following in zip(chain, chain[1:]):
            current.__cause__ = following
        chain[-1].__cause__ = failure
        incoming, outgoing = io.StringIO(json.dumps({'id': '1', 'payload': bars()}) + '\n'), io.StringIO()
        with patch.object(bridge.PublicSession, 'read', side_effect=failure), \
                patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
            bridge.main()
        error = json.loads(outgoing.getvalue())['error']
        self.assertEqual(error['details'], {'exceptionType': 'NetworkError', 'causeTypes': ['TimeoutError', 'ConnectionError', 'RuntimeError', 'ValueError'], 'httpStatus': 502})
        self.assertEqual(error['message'], '[NetworkError] failed via https://[redacted]@localhost/endpoint')
        self.assertNotIn('fixture-secret', outgoing.getvalue())
        self.assertNotIn('cause secret', outgoing.getvalue())

    def test_explicit_context_suppression_and_missing_or_invalid_http_status_are_respected(self):
        failures = []
        for status in [None, '429', 99, 600, True]:
            failure = NetworkError('public fetch failed')
            failure.status_code = status
            failure.__context__ = ConnectionError('implicit context')
            failure.__suppress_context__ = True
            failures.append(failure)
        valid = PermissionDenied('public HTTP refusal')
        valid.status = 403
        valid.__context__ = OSError('native context')
        failures.append(valid)
        incoming = io.StringIO(''.join(json.dumps({'id': str(i), 'payload': bars()}) + '\n' for i in range(len(failures))))
        outgoing = io.StringIO()
        with patch.object(bridge.PublicSession, 'read', side_effect=failures), \
                patch('sys.stdin', incoming), patch('sys.stdout', outgoing):
            bridge.main()
        errors = [json.loads(line)['error'] for line in outgoing.getvalue().splitlines()]
        for error in errors[:-1]:
            self.assertEqual(error['details'], {'exceptionType': 'NetworkError', 'causeTypes': []})
        self.assertEqual(errors[-1]['details'], {'exceptionType': 'PermissionDenied', 'causeTypes': ['OSError'], 'httpStatus': 403})

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
