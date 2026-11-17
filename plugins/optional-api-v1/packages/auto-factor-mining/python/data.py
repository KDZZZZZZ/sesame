"""Frozen UTC grids, local Qlib provider files, and bounded execution manifests."""

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re
import struct
import sys

from formula import FIELD_PATTERN, canonical_json, digest_json

MAX_SHARD_BYTES = 16 * 1024 * 1024
FEATURE_GROUP_SIZE = 128
PINNED = {"pyqlib": "0.9.7", "deap": "1.4.4", "optuna": "5.0.0", "numpy": "1.26.4", "pandas": "2.2.3", "scipy": "1.15.3", "mlflow": "2.22.2", "filelock": "3.20.0"}


class DataError(ValueError):
    code = "INVALID_DATA"


def exact(value, keys, name):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise DataError(f"{name} has unexpected or missing fields")


def utc(value):
    if not isinstance(value, str):
        raise DataError("Time must be a UTC ISO string")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise DataError("Invalid ISO timestamp") from error
    if result.tzinfo is None or result.utcoffset() != timedelta(0):
        raise DataError("Time must have an explicit UTC offset")
    return result.astimezone(timezone.utc)


def iso(value):
    return value.isoformat(timespec="microseconds" if value.microsecond else "seconds").replace("+00:00", "Z")


def frequency(value):
    match = re.fullmatch(r"([1-9][0-9]*)(min|m|h|d)", value) if isinstance(value, str) else None
    if value == "day":
        return "day", timedelta(days=1)
    if not match:
        raise DataError("Frequency requires explicit minute/hour/day grid bars")
    count, unit = int(match[1]), match[2]
    minutes = count * {"min": 1, "m": 1, "h": 60, "d": 1440}[unit]
    return ("day" if minutes == 1440 else f"{minutes}min"), timedelta(minutes=minutes)


def read_bytes(local):
    exact(local, ("path", "digest", "bytes"), "LocalFile")
    path = Path(local["path"])
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise DataError("LocalFile must identify a canonical regular file")
    payload = path.read_bytes()
    if len(payload) != local["bytes"] or "sha256:" + hashlib.sha256(payload).hexdigest() != local["digest"]:
        raise DataError("LocalFile bytes do not match their frozen digest")
    return payload


def read_json(local):
    def reject(value):
        raise DataError(f"Nonfinite JSON number: {value}")
    return json.loads(read_bytes(local).decode("utf-8"), parse_constant=reject)


class Writer:
    def __init__(self, output_dir, limits=None):
        self.root = Path(output_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.limit = (limits or {}).get("maxOutputBytes", 32 * 1024 * 1024)
        self.total = 0

    def write(self, name, payload):
        if len(payload) > MAX_SHARD_BYTES:
            raise DataError("A resource shard exceeds 16 MiB")
        if self.total + len(payload) > self.limit:
            raise DataError("Output exceeds the registered byte budget")
        path = (self.root / name).resolve()
        if not path.is_relative_to(self.root) or path == self.root or path.exists():
            raise DataError("Output must be a new file within its owned attempt")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        self.total += len(payload)
        return {"path": str(path), "digest": "sha256:" + hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}

    def json(self, name, value):
        return self.write(name, canonical_json(value).encode("utf-8"))

    def arrays(self, prefix, rows):
        shards, part, size = [], [], 2
        for row in rows:
            encoded = canonical_json(row).encode("utf-8")
            if len(encoded) + 2 > MAX_SHARD_BYTES:
                raise DataError("One row exceeds the shard budget")
            if part and size + len(encoded) + 1 > MAX_SHARD_BYTES:
                shards.append(self.json(f"{prefix}-{len(shards):05}.json", part))
                part, size = [], 2
            part.append(row)
            size += len(encoded) + 1
        if part or not shards:
            shards.append(self.json(f"{prefix}-{len(shards):05}.json", part))
        return shards

    def feature_index(self, features):
        if len(features) <= FEATURE_GROUP_SIZE:
            return {"features": features}
        groups = [self.json(f"feature-groups/leaf-{index // FEATURE_GROUP_SIZE:05}.json",
                            {"schema": "factor-provider-features/1", "features": features[index:index + FEATURE_GROUP_SIZE]})
                  for index in range(0, len(features), FEATURE_GROUP_SIZE)]
        level = 0
        while len(groups) > FEATURE_GROUP_SIZE:
            level += 1
            groups = [self.json(f"feature-groups/level-{level}-{index // FEATURE_GROUP_SIZE:05}.json",
                                {"schema": "factor-provider-features/1", "groups": groups[index:index + FEATURE_GROUP_SIZE]})
                      for index in range(0, len(groups), FEATURE_GROUP_SIZE)]
        return {"featureGroups": groups}

    def matrix(self, prefix, snapshot_id, partition, keys, columns):
        if any(len(values) != len(keys) for values in columns.values()):
            raise DataError("All matrix columns must share their explicit row keys")
        shards = []
        start = 0
        while start < len(keys) or not shards:
            stop = min(len(keys), start + 10000)
            while True:
                body = {"keys": keys[start:stop], "columns": {column: values[start:stop] for column, values in columns.items()}}
                payload = canonical_json(body).encode("utf-8")
                if len(payload) <= MAX_SHARD_BYTES:
                    break
                if stop - start <= 1:
                    raise DataError("One matrix row exceeds the shard budget")
                stop = start + (stop - start) // 2
            shards.append(self.write(f"{prefix}-{len(shards):05}.json", payload))
            start = stop
            if start >= len(keys):
                break
        manifest = {"schema": "factor-matrix/1", "snapshotId": snapshot_id, "partition": partition, "rowOrderDigest": digest_json(keys), "rows": len(keys), "columns": list(columns), "shards": shards}
        return self.json(f"{prefix}.json", manifest)


def environment_info():
    # Import the actual engine and its native extensions, not metadata alone.
    import qlib
    from qlib.data import D
    from qlib.data._libs import rolling
    import deap
    import optuna
    import numpy
    import pandas
    import scipy
    import mlflow
    versions = {re.sub(r"[-_.]+", "-", dist.metadata["Name"].lower()): dist.version for dist in importlib.metadata.distributions()}
    for name, version in PINNED.items():
        if versions.get(name) != version:
            raise DataError(f"Expected {name}=={version}; found {versions.get(name)}")
    for line in Path(__file__).with_name("requirements-lock.txt").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        name, version = line.split("==", 1)
        if versions.get(re.sub(r"[-_.]+", "-", name.lower())) != version:
            raise DataError(f"Installed dependency differs from the validated lock: {name}=={version}")
    if sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise DataError("The validated environment requires 64-bit CPython 3.12")
    identity = {"python": platform.python_version(), "platform": sys.platform, "packages": versions}
    return {"ready": True, "pythonPath": sys.executable, "versions": versions, "environmentDigest": digest_json(identity)}


def prepare(request, limits=None):
    exact(request, ("sourceRef", "rows", "layout", "budget", "outputDir"), "prepare input")
    layout = request["layout"]
    exact(layout, ("universe", "frequency", "timezone", "availableAt", "development", "holdout", "target"), "layout")
    if layout["timezone"] != "UTC" or layout["availableAt"] != "bar_close":
        raise DataError("Frozen source bars require UTC bar-close availability")
    qfreq, step = frequency(layout["frequency"])
    dev_start, dev_end = map(utc, layout["development"])
    hold_start, hold_end = map(utc, layout["holdout"])
    if not dev_start <= dev_end < hold_start <= hold_end:
        raise DataError("Development and holdout must be ordered and disjoint")
    target = layout["target"]
    exact(target, ("kind", "field", "horizonBars", "scale") if target.get("kind") == "provided" else ("kind", "field", "horizonBars"), "target")
    if target["kind"] not in ("provided", "forward_return", "forward_volatility") or not FIELD_PATTERN.fullmatch(target["field"]):
        raise DataError("Invalid frozen target")
    horizon = target["horizonBars"]
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 10000:
        raise DataError("Target horizon must be positive and bounded")
    universe = layout["universe"]
    if not isinstance(universe, list) or not universe or len(universe) != len(set(universe)) or any(not isinstance(symbol, str) or not symbol or len(symbol) > 128 for symbol in universe):
        raise DataError("Universe must contain distinct bounded symbol names")
    rows, fields, seen = [], set(), set()
    for local in request["rows"]:
        shard = read_json(local)
        if not isinstance(shard, list):
            raise DataError("A source shard must be a row array")
        for row in shard:
            exact(row, ("time", "symbol", "availableAt", "fields"), "source row")
            time, available = utc(row["time"]), utc(row["availableAt"])
            if row["symbol"] not in universe:
                continue
            if (row["symbol"], time) in seen:
                raise DataError("Duplicate source bar")
            seen.add((row["symbol"], time))
            if not isinstance(row["fields"], dict) or not row["fields"]:
                raise DataError("Source fields must be a nonempty object")
            for field, value in row["fields"].items():
                if not FIELD_PATTERN.fullmatch(field) or value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                    raise DataError("Source fields require safe names and finite numbers or null")
            fields.update(row["fields"])
            rows.append({"time": iso(time), "symbol": row["symbol"], "availableAt": iso(available), "fields": row["fields"]})
    if not rows or target["field"] not in fields:
        raise DataError("Source contains no declared universe rows or target field")
    rows.sort(key=lambda row: (row["symbol"], utc(row["time"])))
    first = min(utc(row["time"]) for row in rows)
    last = max(max(utc(row["time"]) for row in rows), hold_end + horizon * step)
    if first > dev_start:
        first = dev_start
    for instant in [dev_start, dev_end, hold_start, hold_end, *(utc(row["time"]) for row in rows)]:
        if (instant - first) % step:
            raise DataError("Source bars and partition bounds must share the frozen frequency grid")
    count = (last - first) // step + 1
    byte_limit = (limits or {}).get("maxOutputBytes", request["budget"]["maxOutputBytes"])
    if count > byte_limit // 16:
        raise DataError("Frozen calendar would exceed the output budget")
    calendar = [{"barIndex": index, "time": iso(first + index * step), "qlibTime": (first + index * step).replace(tzinfo=None).isoformat(sep=" ")} for index in range(count)]
    symbols = [{"original": symbol, "synthetic": f"s{index:06}"} for index, symbol in enumerate(sorted(universe))]
    snapshot_id = "snapshot-" + digest_json({"source": request["sourceRef"], "layout": layout, "calendar": calendar, "rows": rows})[7:31]
    writer = Writer(request["outputDir"], limits or {"maxOutputBytes": byte_limit})
    calendar_file = writer.json("calendar.json", calendar)
    symbol_file = writer.json("symbols.json", symbols)
    indexed = {(row["symbol"], (utc(row["time"]) - first) // step): row for row in rows}
    features = []
    for symbol in symbols:
        for field in sorted(fields):
            values = [0.0]
            for index in range(count):
                row = indexed.get((symbol["original"], index))
                value = row["fields"].get(field) if row and utc(row["availableAt"]) <= utc(row["time"]) else None
                values.append(float("nan") if value is None else float(value))
            try:
                binary = struct.pack("<" + "f" * len(values), *values)
            except OverflowError as error:
                raise DataError("Source value is outside Qlib float32 storage range") from error
            features.append({"symbol": symbol["synthetic"], "field": field, "file": writer.write(f"features/{symbol['synthetic']}/{field}.{qfreq}.bin", binary)})
    provider = writer.json("provider.json", {"schema": "factor-provider/1", "frequency": qfreq, "calendar": calendar_file, "symbolMap": symbol_file, **writer.feature_index(features)})
    partitions = {}
    for name, end in (("development", dev_end), ("holdout", hold_end + horizon * step)):
        retained = [row for row in rows if utc(row["time"]) <= end]
        shards = writer.arrays(f"{name}-rows", retained)
        partitions[name] = writer.json(f"{name}.json", {"schema": "factor-source-rows/1", "snapshotId": snapshot_id, "partition": name, "rows": len(retained), "shards": shards})
    ledger = writer.json("usage.json", {"schema": "factor-usage/1", "snapshotId": snapshot_id, "holdoutExposures": []})
    safe_fields = sorted(fields - ({target["field"]} if target["kind"] == "provided" else set()))
    return {"snapshot": {"id": snapshot_id, "layout": layout, "fields": safe_fields, "calendarDigest": digest_json(calendar)}, **partitions, "provider": provider, "usageLedger": ledger}


def hydrate_provider(local, root):
    """Reconstruct solely from supplied manifest children, never an old provider path."""
    provider = read_json(local)
    grouped = "featureGroups" in provider
    exact(provider, ("schema", "frequency", "calendar", "symbolMap", "featureGroups" if grouped else "features"), "provider")
    if provider["schema"] != "factor-provider/1":
        raise DataError("Unexpected provider schema")
    calendar, symbols = read_json(provider["calendar"]), read_json(provider["symbolMap"])
    qfreq, _ = frequency(provider["frequency"])
    if qfreq != provider["frequency"] or not calendar or not symbols:
        raise DataError("Invalid provider frequency/calendar/symbol map")
    for index, bar in enumerate(calendar):
        exact(bar, ("barIndex", "time", "qlibTime"), "calendar bar")
        if bar["barIndex"] != index or datetime.fromisoformat(bar["qlibTime"]).replace(tzinfo=timezone.utc) != utc(bar["time"]) or index and utc(bar["time"]) <= utc(calendar[index - 1]["time"]):
            raise DataError("Calendar mapping is not ordered and canonical")
    symbol_names = set()
    originals = set()
    for item in symbols:
        exact(item, ("original", "synthetic"), "symbol map")
        if not isinstance(item["original"], str) or not re.fullmatch(r"s[0-9]{6}", item["synthetic"]) or item["synthetic"] in symbol_names or item["original"] in originals:
            raise DataError("Invalid or duplicate synthetic symbol")
        symbol_names.add(item["synthetic"])
        originals.add(item["original"])
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / "calendars").mkdir(exist_ok=True)
    (root / "calendars" / f"{qfreq}.txt").write_text("\n".join(bar["qlibTime"] for bar in calendar) + "\n", encoding="utf-8")
    def entries(items, name):
        if not isinstance(items, list) or not 1 <= len(items) <= FEATURE_GROUP_SIZE:
            raise DataError(f"Provider {name} must contain 1..{FEATURE_GROUP_SIZE} entries")
        return items

    def group_features(local, depth=0):
        if depth > 16:
            raise DataError("Provider feature groups are too deeply nested")
        group = read_json(local)
        branch = "groups" if "groups" in group else "features"
        exact(group, ("schema", branch), "provider feature group")
        if group["schema"] != "factor-provider-features/1":
            raise DataError("Unexpected provider feature-group schema")
        for item in entries(group[branch], branch):
            if branch == "features":
                yield item
            else:
                yield from group_features(item, depth + 1)

    feature_rows = [feature for local in entries(provider["featureGroups"], "featureGroups") for feature in group_features(local)] if grouped else entries(provider["features"], "features")
    features = set()
    for feature in feature_rows:
        exact(feature, ("symbol", "field", "file"), "provider feature")
        if feature["symbol"] not in symbol_names or not FIELD_PATTERN.fullmatch(feature["field"]) or (feature["symbol"], feature["field"]) in features:
            raise DataError("Unsafe or duplicate provider feature")
        features.add((feature["symbol"], feature["field"]))
        payload = read_bytes(feature["file"])
        if len(payload) != 4 * (len(calendar) + 1) or struct.unpack("<f", payload[:4])[0] != 0:
            raise DataError("Provider features must cover the frozen calendar from index zero")
        target = root / "features" / feature["symbol"] / f"{feature['field']}.{qfreq}.bin"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    return {**provider, "features": feature_rows}, calendar, symbols
