"""Exact, bounded input handling for a local observational study. No network.

This generic file is also shipped in the independently loadable ICT package.
It imports no other method and does not verify a host artifact's signature.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024
MAX_ROWS = 10000


def require(ok, message):
    if not ok:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and 0 < len(value) <= 1000


def number(value):
    require(isinstance(value, str) and len(value) <= 90
            and re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value)
            and sum(c.isdigit() for c in value) <= 80,
            "INVALID_INPUT: use bounded exact Decimal strings, not floats/exponents")
    return Decimal(value)


def source_time(value):
    require(isinstance(value, dict), "INVALID_INPUT: SourceTime object required")
    if value.get("basis") == "utc":
        require(set(value) <= {"basis", "unixMs", "raw"}
                and type(value.get("unixMs")) is int
                and abs(value["unixMs"]) <= 9007199254740991
                and ("raw" not in value or isinstance(value["raw"], str)),
                "INVALID_INPUT: UTC requires safe integer unixMs")
        return ("utc",), value["unixMs"]
    require(value.get("basis") == "wall" and text(value.get("authority")),
            "INVALID_INPUT: explicit wall authority required")
    require("fold" not in value, "UNSUPPORTED_CAPABILITY: wall DST fold is not resolved")
    require(set(value) <= {"basis", "authority", "zone", "value"}
            and ("zone" not in value or text(value["zone"])),
            "INVALID_INPUT: invalid wall SourceTime fields")
    raw = value.get("value")
    require(isinstance(raw, str) and re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,18})?", raw),
        "UNSUPPORTED_CAPABILITY: bounded local wall timestamp required")
    parsed = datetime.fromisoformat(raw[:19])  # validate the actual calendar date
    fraction = Decimal("0." + raw.split(".", 1)[1]) if "." in raw else Decimal(0)
    return ("wall", value["authority"], value.get("zone")), (parsed, fraction)


def validate_source(source):
    require(isinstance(source, dict) and set(source) <= {
        "ref", "instrument", "spec", "provenance_kind", "coverage", "snapshot_observed_at"
    }, "INVALID_INPUT: source descriptor has unknown fields; do not include credentials")
    kind = source.get("provenance_kind")
    require(kind in ["observed", "derived", "user_input", "demo"], "INVALID_INPUT: provenance kind required")
    ref = source.get("ref")
    if ref is None:
        require(kind == "demo", "INVALID_INPUT: non-demo input requires a fixed DataRef")
    else:
        require(isinstance(ref, dict) and set(ref) == {"id", "revision", "digest", "kind", "schemaVersion"}
                and text(ref.get("id")) and text(ref.get("revision"))
                and re.fullmatch(r"sha256:[a-f0-9]{64}", str(ref.get("digest")))
                and ref.get("kind") == "data" and ref.get("schemaVersion") == "1.0.0",
                "INVALID_INPUT: complete data ArtifactRef required")
    instrument = source.get("instrument")
    require(isinstance(instrument, dict) and set(instrument) == {"sourceId", "instrumentId"}
            and all(text(v) for v in instrument.values()), "INVALID_INPUT: instrument identity required")
    spec = source.get("spec")
    require(isinstance(spec, dict) and set(spec) == {
        "timeframe", "priceBasis", "adjustment", "session", "calendarRevision"
    } and all(text(spec[k]) for k in ["timeframe", "priceBasis", "adjustment", "session"])
        and isinstance(spec.get("calendarRevision"), dict), "INVALID_INPUT: full series spec required")
    require(isinstance(source.get("coverage"), dict) and type(source["coverage"].get("complete")) is bool,
            "INVALID_INPUT: retain actual coverage including complete status")
    observed = source.get("snapshot_observed_at")
    require(observed is None or type(observed) is int and abs(observed) <= 9007199254740991,
            "INVALID_INPUT: snapshot_observed_at is UTC unixMs or null")
    return source


def validate_rows(rows):
    require(isinstance(rows, list) and len(rows) <= MAX_ROWS,
            "RESOURCE_EXHAUSTED: expected at most 10000 rows")
    seen, clock, last_open, last_end = set(), None, None, None
    values = []
    volume_identity = None
    for row in rows:
        require(isinstance(row, dict) and text(row.get("id")) and row["id"] not in seen,
                "INVALID_INPUT: each row needs a unique bar id")
        seen.add(row["id"])
        require(isinstance(row.get("revision"), str) and re.fullmatch(r"(?:0|[1-9][0-9]*)", row["revision"]),
                "INVALID_INPUT: unsigned integer string bar revision required")
        require(row.get("is_closed") is True and row.get("closure") in ["source", "calendar"],
                "UNSUPPORTED_CAPABILITY: require explicitly closed bars and closure evidence")
        identity, start = source_time(row.get("datetime"))
        end_identity, end = source_time(row.get("end_time"))
        require(identity == end_identity and start < end, "INVALID_INPUT: invalid bar time interval")
        require(clock is None or clock == identity, "UNSUPPORTED_CAPABILITY: mixed source clocks")
        require(last_open is None or last_open < start and last_end <= start,
                "INVALID_INPUT: rows must ascend without duplicate times or overlapping intervals")
        clock, last_open, last_end = identity, start, end
        price = {k: number(row.get(k)) for k in ["open", "high", "low", "close"]}
        require(price["low"] <= price["open"] <= price["high"]
                and price["low"] <= price["close"] <= price["high"], "INVALID_INPUT: OHLC bounds")
        kind, status, unit, volume = (row.get(k) for k in ["volume_kind", "volume_status", "volume_unit", "volume"])
        require(kind in ["real", "tick", "none"], "INVALID_INPUT: explicit volume kind required")
        require(status in ["value", "unknown", "unsupported", "not_applicable", "not_requested"],
                "INVALID_INPUT: explicit volume status required")
        if kind == "none":
            require(volume is None and unit is None and status == "not_requested",
                    "INVALID_INPUT: unrequested volume must stay null")
        elif status == "value":
            require(number(volume) >= 0 and text(unit), "INVALID_INPUT: nonnegative volume and unit required")
            if kind == "tick":
                require(unit == "tick" and re.fullmatch(r"(?:0|[1-9][0-9]*)", volume),
                        "INVALID_INPUT: tick volume is an integer count")
        else:
            require(status != "not_requested" and volume is None and unit is None,
                    "INVALID_INPUT: unknown selected volume must stay null with its real status")
        current = (kind, unit) if status == "value" else (kind, None)
        require(volume_identity is None or volume_identity[0] == kind,
                "UNSUPPORTED_CAPABILITY: mixed volume kinds")
        if volume_identity and volume_identity[1] and current[1]:
            require(volume_identity[1] == current[1], "UNSUPPORTED_CAPABILITY: mixed volume units")
        if volume_identity is None or current[1]:
            volume_identity = current
        values.append(price)
    return values


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def observation(method, kind, rows, source, index, confirmed_index, anchors, params, details):
    relevant = [rows[i] for i in anchors]
    identity = [method, kind, source["instrument"], source["spec"], params, relevant]
    return {
        "id": "observation_" + hashlib.sha256(canonical(identity).encode()).hexdigest(),
        "method": method, "rule_version": "1", "kind": kind,
        "event_time": rows[index]["datetime"], "confirmed_at": rows[confirmed_index]["end_time"],
        "availability": "source-close lower bound; actual delivery/tradability unknown",
        "anchors": [{"id": r["id"], "revision": r["revision"]} for r in relevant],
        "source_ref": source.get("ref"), "provenance_kind": source["provenance_kind"],
        "parameters": params, **details,
    }


def load_json(path):
    data = Path(path).read_bytes()
    require(len(data) <= MAX_BYTES, "RESOURCE_EXHAUSTED: input exceeds 8 MiB")
    return json.loads(data.decode("utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(
        ValueError("INVALID_INPUT: non-finite JSON constant"))), data


def run_cli(observe, windows=False):
    parser = argparse.ArgumentParser(description="Local closed-bar observations, not a strategy or backtest")
    for name in ["input", "source", "output"]:
        parser.add_argument("--" + name, required=True)
    if windows:
        parser.add_argument("--left", type=int, default=2)
        parser.add_argument("--right", type=int, default=2)
    args = parser.parse_args()
    try:
        paths = [Path(getattr(args, k)).resolve() for k in ["input", "source", "output"]]
        require(len(set(paths)) == 3, "INVALID_INPUT: input, source and output paths must differ")
        rows, raw = load_json(args.input)
        source, _ = load_json(args.source)
        events = observe(rows, source, args.left, args.right) if windows else observe(rows, source)
        encoded = (json.dumps(events, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
        require(len(encoded) <= MAX_BYTES, "RESOURCE_EXHAUSTED: output exceeds 8 MiB; narrow the input")
        paths[2].parent.mkdir(parents=True, exist_ok=True)
        paths[2].write_bytes(encoded)
        print(json.dumps({"observations": len(events), "rows": len(rows), "output": str(paths[2]),
                          "input_sha256": hashlib.sha256(raw).hexdigest(), "coverage": source["coverage"],
                          "snapshot_observed_at": source.get("snapshot_observed_at"),
                          "scope": "local exact observations; supplied artifact ref not independently verified"}, ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, str(error) + "\n")
