"""Persistent, serial public-only CCXT boundary. No keys, private calls or orders."""
import sys
import json
import math
import decimal
import time
import uuid
import re
from urllib.parse import urlparse

import ccxt

LIMITS = {'kraken': 500, 'coinbase': 300, 'okx': 300}


class RequestError(ValueError):
    def __init__(self, message, code='INVALID_ARGUMENT'):
        super().__init__(message)
        self.code = code


def norm(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            raise RequestError('Nonfinite upstream number', 'SOURCE_DATA_INVALID')
        return format(decimal.Decimal(str(value)), 'f')
    if isinstance(value, list):
        return [norm(item) for item in value]
    if isinstance(value, dict):
        return {str(key): norm(item) for key, item in value.items()}
    return value


class PublicSession:
    def __init__(self):
        self.exchange = None
        self.identity = None
        self.markets_at = 0
        self.session_id = str(uuid.uuid4())
        self.requests = 0

    def read(self, payload):
        if not isinstance(payload, dict) or set(payload) - {'exchange', 'publicProxy', 'action', 'symbol', 'timeframe', 'since', 'limit'}:
            raise RequestError('Only fixed public request fields are accepted')
        exchange_id = payload.get('exchange')
        if exchange_id not in LIMITS:
            raise RequestError('Unsupported explicit exchange')
        action = payload.get('action')
        if action not in ['markets', 'bars', 'ticker']:
            raise RequestError('Unsupported fixed public operation')
        public_proxy = payload.get('publicProxy')
        if public_proxy is not None:
            if not isinstance(public_proxy, str):
                raise RequestError('Only explicit credential-free public proxy')
            proxy = urlparse(public_proxy)
            if proxy.scheme not in ['http', 'https'] or not proxy.hostname or proxy.username or proxy.password or proxy.query or proxy.fragment or proxy.path not in ['', '/']:
                raise RequestError('Only explicit credential-free public proxy')
        identity = (exchange_id, public_proxy)
        if self.exchange is None:
            settings = {'enableRateLimit': True, 'timeout': 15000, 'options': {'defaultType': 'spot'}}
            if public_proxy:
                settings['httpsProxy'] = public_proxy
            self.exchange = getattr(ccxt, exchange_id)(settings)
            self.identity = identity
        elif identity != self.identity:
            raise RequestError('Public session route cannot change', 'CONNECTION_CHANGED')
        exchange = self.exchange
        # CCXT's cache and rate limiter stay alive. Periodic refresh allows newly
        # listed/delisted spot instruments without a process per chart request.
        refresh = bool(self.markets_at and time.monotonic() - self.markets_at >= 300)
        markets = exchange.load_markets(reload=refresh)
        if not self.markets_at or refresh:
            self.markets_at = time.monotonic()
        if action == 'markets':
            fields = ['id', 'symbol', 'base', 'quote', 'active', 'spot', 'precision', 'limits']
            rows = []
            for market in markets.values():
                if market.get('spot') and market.get('active') is not False:
                    row = {key: market.get(key) for key in fields}
                    row['precisionMode'] = exchange.precisionMode
                    rows.append(row)
        else:
            market = exchange.market(payload.get('symbol'))
            if not market.get('spot') or market.get('active') is False:
                raise RequestError('Only active public spot markets')
            if action == 'bars':
                timeframe = payload.get('timeframe')
                if timeframe not in ['1m', '5m', '15m', '1h', '1d'] or not exchange.has.get('fetchOHLCV') or timeframe not in exchange.timeframes:
                    raise RequestError('Unsupported OHLCV timeframe', 'UNSUPPORTED_CAPABILITY')
                since, limit = payload.get('since'), payload.get('limit', LIMITS[exchange_id])
                if type(since) is not int or type(limit) is not int or not 1 <= limit <= LIMITS[exchange_id]:
                    raise RequestError('Explicit since and bounded native limit required')
                rows = exchange.fetch_ohlcv(payload['symbol'], timeframe, since, limit)
            else:
                rows = exchange.fetch_ticker(payload['symbol'])
        self.requests += 1
        return {
            'rows': norm(rows), 'library': ccxt.__version__, 'exchange': exchange.id,
            'observedAt': time.time_ns() // 1000000,
            'sessionId': self.session_id, 'requestNumber': self.requests,
        }

    def close(self):
        close = getattr(self.exchange, 'close', None)
        if close:
            close()


def main():
    session = PublicSession()
    try:
        for line in sys.stdin:
            request = None
            try:
                if len(line) > 65536:
                    raise RequestError('Public request exceeds input budget', 'RESOURCE_EXHAUSTED')
                request = json.loads(line)
                if not isinstance(request, dict) or not isinstance(request.get('id'), str):
                    raise RequestError('Public request identity required')
                response = {'id': request['id'], 'result': session.read(request.get('payload'))}
                encoded = json.dumps(response, allow_nan=False)
                if len(encoded.encode('utf-8')) > 8 * 1024 * 1024:
                    raise RequestError('Public response exceeds output budget', 'RESOURCE_EXHAUSTED')
            except Exception as error:
                message = re.sub(r'(https?://)[^\s/@]+(?::[^\s/@]*)?@', r'\1[redacted]@', str(error))[-1500:]
                encoded = json.dumps({'id': request.get('id') if isinstance(request, dict) else None, 'error': {
                    'code': error.code if isinstance(error, RequestError) else 'SOURCE_UNAVAILABLE', 'message': message,
                }}, allow_nan=False)
            print(encoded, flush=True)
    finally:
        session.close()


if __name__ == '__main__':
    main()
