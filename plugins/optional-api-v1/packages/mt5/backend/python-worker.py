"""Trusted persistent JSON-lines bridge. Only official MetaTrader5 functions, never eval."""
import datetime
import json
import math
import sys

import MetaTrader5 as mt5
import numpy as np

ALLOWED = set('initialize login shutdown version last_error account_info terminal_info symbols_total symbols_get symbol_info symbol_info_tick symbol_select market_book_add market_book_get market_book_release copy_rates_from copy_rates_from_pos copy_rates_range copy_ticks_from copy_ticks_range orders_total orders_get order_calc_margin order_calc_profit order_check order_send positions_total positions_get history_orders_total history_orders_get history_deals_total history_deals_get'.split())
POSITIONAL = {
    'symbol_info': ['symbol'], 'symbol_info_tick': ['symbol'], 'symbol_select': ['symbol', 'enable'],
    'market_book_add': ['symbol'], 'market_book_get': ['symbol'], 'market_book_release': ['symbol'],
    'copy_rates_from': ['symbol', 'timeframe', 'date_from', 'count'],
    'copy_rates_from_pos': ['symbol', 'timeframe', 'start_pos', 'count'],
    'copy_rates_range': ['symbol', 'timeframe', 'date_from', 'date_to'],
    'copy_ticks_from': ['symbol', 'date_from', 'count', 'flags'],
    'copy_ticks_range': ['symbol', 'date_from', 'date_to', 'flags'],
    'order_calc_margin': ['action', 'symbol', 'volume', 'price'],
    'order_calc_profit': ['action', 'symbol', 'volume', 'price_open', 'price_close'],
    'order_check': ['request'], 'order_send': ['request'],
    'history_orders_total': ['date_from', 'date_to'], 'history_deals_total': ['date_from', 'date_to'],
}
IDS = {'ticket', 'order', 'deal', 'position', 'position_id', 'position_by', 'identifier', 'magic', 'login'}
ENUMS = {'timeframe', 'flags', 'action', 'type', 'type_time', 'type_filling'}


def convert_input(value, key=''):
    if isinstance(value, dict):
        return {k: convert_input(v, k) for k, v in value.items()}
    if key in ENUMS and isinstance(value, str):
        if not value.isupper() or not isinstance(getattr(mt5, value, None), int):
            raise ValueError('Unknown MT5 enum constant')
        return getattr(mt5, value)
    if key in IDS:
        value = int(value)
        if not 0 <= value <= 2**64 - 1:
            raise ValueError('Ticket out of range')
    if key in {'date_from', 'date_to'}:
        value = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError('Datetime must include timezone')
        return value.astimezone(datetime.timezone.utc)
    return value


def clean(value, key=''):
    if hasattr(value, '_asdict'):
        return clean(value._asdict())
    if isinstance(value, np.ndarray):
        if len(value) > 100000:
            raise ValueError('Result exceeds 100000 rows; use a smaller time range')
        return [clean(dict(zip(value.dtype.names, row))) for row in value] if value.dtype.names else clean(value.tolist())
    if isinstance(value, np.generic):
        return clean(value.item(), key)
    if isinstance(value, dict):
        return {k: clean(v, k) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [clean(v) for v in value]
    if isinstance(value, int) and (key in IDS or abs(value) > 2**53 - 1):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


for line in sys.stdin:
    try:
        command = json.loads(line)
        name = command['tool']
        if name not in ALLOWED:
            raise ValueError('Function not allowed')
        args = convert_input(command.get('arguments', {}))
        if 'count' in args and not 1 <= args['count'] <= 100000:
            raise ValueError('count must be 1..100000')
        if name == 'initialize':
            account = command.get('account') or {}
            credentials = {k: account[k] for k in ['password', 'server'] if account.get(k)}
            if account.get('login'):
                credentials['login'] = int(account['login'])
            result = mt5.initialize(command['terminal'], timeout=15000, **credentials)
        elif name == 'login':
            account = command.get('account') or {}
            credentials = {k: account[k] for k in ['password', 'server'] if account.get(k)}
            result = mt5.login(int(account['login']), timeout=15000, **credentials)
        else:
            positional = POSITIONAL.get(name, [])
            if name in {'history_orders_get', 'history_deals_get'} and 'date_from' in args:
                positional = ['date_from', 'date_to']
            values = [args.pop(key) for key in positional]
            result = getattr(mt5, name)(*values, **args)
        output = {'result': clean(result), 'last_error': clean(mt5.last_error()), 'package_version': mt5.__version__}
        text = json.dumps(output, ensure_ascii=True, allow_nan=False)
        if len(text) > 8 * 1024 * 1024:
            raise ValueError('Result exceeds 8 MiB; use a smaller time range')
    except Exception as error:
        # Do not echo exceptions containing user credentials or native process arguments.
        text = json.dumps({'error': type(error).__name__, 'message': 'Official Python call failed; check function parameters and terminal connection.'})
    print(text, flush=True)

mt5.shutdown()
