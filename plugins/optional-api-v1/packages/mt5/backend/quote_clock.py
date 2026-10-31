"""Bounded current-tick clock conversion; no clock fitting, SDK calls, or history conversion."""
import datetime
import json
from pathlib import Path

SOURCE = "mt5/python/symbol_info_tick"
RULES = json.loads(Path(__file__).with_name("quote-clock-rules.json").read_text(encoding="utf-8"))
_EPOCH = datetime.datetime(1970, 1, 1)


def _field(value, name):
    return value.get(name) if isinstance(value, dict) else getattr(value, name, None)


def _identity(account):
    login, server = _field(account, "login"), _field(account, "server")
    if type(login) is not int or not 0 < login < 2**64 or not isinstance(server, str) or not server:
        return None
    return str(login), server


def _wall_ms(value):
    # Calendar fields in this file are deliberately timezone-free server wall time.
    return (datetime.datetime.fromisoformat(value) - _EPOCH) // datetime.timedelta(milliseconds=1)


def resolve_quote_clock(tick, account_before, account_after):
    """Return a separate proof without changing raw tick fields or consulting current time."""
    raw = _field(tick, "time_msc")
    valid_raw = type(raw) is int and 0 < raw <= 2**53 - 1
    before, after = _identity(account_before), _identity(account_after)
    proof = {
        "status": "unverified", "source": SOURCE,
        "server": before[1] if before else "", "accountId": before[0] if before else "",
        "rawTimeMs": raw if valid_raw else None, "sourceTimeMs": None,
        "basis": "unknown", "offsetMinutes": None, "ruleId": None, "ruleRevision": None,
    }
    if not before or not after:
        return {**proof, "reason": "ACCOUNT_IDENTITY_UNAVAILABLE"}
    if before != after:
        return {**proof, "reason": "ACCOUNT_CHANGED_DURING_QUOTE"}
    if not valid_raw:
        return {**proof, "reason": "INVALID_SOURCE_TIMESTAMP"}
    matches = [rule for rule in RULES["rules"] if rule["server"] == before[1] and rule["source"] == SOURCE]
    if len(matches) != 1:
        return {**proof, "reason": "SERVER_RULE_UNAVAILABLE"}
    rule = matches[0]
    proof.update(ruleId=rule["id"], ruleRevision=rule["revision"])
    intervals = [item for item in rule["intervals"] if _wall_ms(item["from"]) <= raw < _wall_ms(item["until"])]
    if len(intervals) != 1:
        return {**proof, "reason": "CLOCK_PERIOD_UNVERIFIED"}
    interval = intervals[0]
    if "offsetMinutes" not in interval:
        return {**proof, "reason": interval["reason"]}
    offset = interval["offsetMinutes"]
    return {**proof, "status": "verified", "sourceTimeMs": raw - offset * 60000,
            "basis": rule["basis"], "offsetMinutes": offset}
