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


def error_code(error):
    if isinstance(error, RequestError):
        return error.code
    if isinstance(error, ccxt.RateLimitExceeded):
        return 'RATE_LIMITED'
    if isinstance(error, ccxt.RequestTimeout):
        return 'TIMEOUT'
    # CCXT 4.5.85 classifies these Kraken rate limits as DDoSProtection,
    # alongside unrelated lockouts. Only the exact rate-limit payload qualifies.
    message = str(error)
    if isinstance(error, ccxt.DDoSProtection) and message.startswith('kraken '):
        try:
            response = json.loads(message[len('kraken '):])
        except json.JSONDecodeError:
            response = None
        errors = response.get('error') if isinstance(response, dict) else None
        if isinstance(errors, list) and errors and all(code in (
                'EGeneral:Too many requests', 'EAPI:Rate limit exceeded', 'EOrder:Rate limit exceeded',
        ) for code in errors):
            return 'RATE_LIMITED'
    return 'SOURCE_UNAVAILABLE'


def error_details(error):
    details = {'exceptionType': type(error).__name__[:80], 'causeTypes': []}
    current, seen = error, {id(error)}
    for _ in range(4):
        current = current.__cause__ if current.__cause__ is not None else (
            None if current.__suppress_context__ else current.__context__)
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        details['causeTypes'].append(type(current).__name__[:80])
    # A network failure may have no HTTP response. Do not infer status from its
    # URL, message or exchange; preserve only an actual numeric response status.
    response = getattr(error, 'response', None)
    for status in (getattr(error, 'status_code', None), getattr(error, 'status', None), getattr(response, 'status_code', None)):
        if type(status) is int and 100 <= status <= 599:
            details['httpStatus'] = status
            break
    return details


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
                details = error_details(error)
                encoded = json.dumps({'id': request.get('id') if isinstance(request, dict) else None, 'error': {
                    'code': error_code(error), 'message': f"[{details['exceptionType']}] {message}", 'details': details,
                }}, allow_nan=False)
            print(encoded, flush=True)
    finally:
        session.close()


if __name__ == '__main__':
    main()
