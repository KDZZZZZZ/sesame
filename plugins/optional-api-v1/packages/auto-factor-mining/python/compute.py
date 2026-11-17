"""The Qlib-only computation boundary for one frozen snapshot per invocation."""

import math
from pathlib import Path
import struct

from data import DataError, Writer, environment_info, exact, hydrate_provider, prepare as prepare_data, read_bytes, read_json, utc
from formula import OPERATOR_DIGEST, ROLLING, digest_json, validate_and_compile


def prepare(request, limits=None):
    return prepare_data(request, limits)


def _error(error):
    return {"code": getattr(error, "code", "COMPUTE_FAILED"), "message": str(error)[:2000], "retryable": False}


def _finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _warmup(tree, first):
    if "field" in tree:
        return first[tree["field"]]
    if "constant" in tree:
        return 0
    op, args = tree["call"], tree["args"]
    start = max(_warmup(arg, first) for arg in args)
    return start + int(args[1]["constant"]) - (0 if op == "Ref" else 1) if op == "Ref" or op in ROLLING else start


def compute(request, limits=None):
    if not isinstance(request, dict) or not {"snapshot", "candidates", "partition", "outputDir"}.issubset(request) or set(request) - {"snapshot", "candidates", "partition", "diagnostics", "outputDir"}:
        raise DataError("Compute requires the fixed worker input")
    partition = request["partition"]
    if partition not in ("development", "holdout"):
        raise DataError("Unknown frozen partition")
    snapshot = read_json(request["snapshot"])
    layout = snapshot["layout"]
    start, end = map(utc, layout[partition])
    provider, calendar, symbols = hydrate_provider(snapshot["provider"], Path(request["outputDir"]) / "qlib-provider")
    if digest_json(calendar) != snapshot["calendarDigest"] or set(layout["universe"]) != {symbol["original"] for symbol in symbols}:
        raise DataError("Provider calendar/universe differs from the frozen snapshot")
    environment = environment_info()
    engine = {"name": "qlib", "version": environment["versions"]["pyqlib"], "environmentDigest": environment["environmentDigest"], "operatorDigest": OPERATOR_DIGEST}
    import qlib
    from qlib.data import D
    from qlib.data.cache import H
    import pandas as pd

    H.clear()
    qlib.init(
        provider_uri=str((Path(request["outputDir"]) / "qlib-provider").resolve()),
        kernels=1,
        expression_cache=None,
        dataset_cache=None,
        calendar_cache=None,
        local_cache_path=None,
        default_disk_cache=0,
        logging_level=40,
        exp_manager={"class": "MLflowExpManager", "module_path": "qlib.workflow.expm", "kwargs": {"uri": (Path(request["outputDir"]).resolve() / "mlruns").as_uri(), "default_exp_name": "factor-research"}},
    )
    bars = [bar for bar in calendar if start <= utc(bar["time"]) <= end]
    if not bars:
        raise DataError("The frozen partition contains no calendar positions")
    keys = [{"symbol": symbol["original"], "barIndex": bar["barIndex"], "time": bar["time"]} for symbol in symbols for bar in bars]
    inverse = {symbol["original"]: symbol["synthetic"] for symbol in symbols}
    index = pd.MultiIndex.from_tuples([(inverse[key["symbol"]], pd.Timestamp(calendar[key["barIndex"]]["qlibTime"])) for key in keys], names=["instrument", "datetime"])
    first = {symbol["synthetic"]: {} for symbol in symbols}
    for feature in provider["features"]:
        values = struct.unpack("<" + "f" * (len(calendar) + 1), read_bytes(feature["file"]))[1:]
        first[feature["symbol"]][feature["field"]] = next((i for i, value in enumerate(values) if math.isfinite(value)), len(calendar) + 1)

    def query(expressions):
        # Qlib receives only reconstructed, validated expressions or fixed target code.
        return D.features([symbol["synthetic"] for symbol in symbols], list(dict.fromkeys(expressions)), start_time=bars[0]["qlibTime"], end_time=bars[-1]["qlibTime"], freq=provider["frequency"], disk_cache=0).reindex(index)

    def column(frame, expression, formula=None):
        values = [_finite(value) for value in frame[expression].tolist()]
        if formula is not None:
            warmup = {symbol["original"]: _warmup(formula["tree"], first[symbol["synthetic"]]) for symbol in symbols}
            values = [None if key["barIndex"] < warmup[key["symbol"]] else value for key, value in zip(keys, values)]
        return values

    candidates = request["candidates"]
    if not isinstance(candidates, list) or not candidates or len(candidates) > 256:
        raise DataError("A compute block requires 1..256 candidates")
    results, compiled, columns = [], {}, {}
    ids = set()
    for candidate in candidates:
        candidate_id = candidate.get("id") if isinstance(candidate, dict) else None
        if not isinstance(candidate_id, str) or not candidate_id or candidate_id in ids:
            raise DataError("Candidates require distinct IDs")
        ids.add(candidate_id)
        try:
            exact(candidate, ("id", "formula", "hypothesis", "origin"), "candidate")
            compiled[candidate_id] = validate_and_compile(candidate["formula"], {"fields": snapshot["fields"]})
            results.append({"id": candidate_id, "status": "ok", "value": {"candidate": candidate, "column": candidate_id, "computeKey": digest_json({"formula": compiled[candidate_id]["digest"], "snapshotId": snapshot["id"], "calendarDigest": snapshot["calendarDigest"], "layout": layout, "partition": partition, "engine": engine})}})
        except Exception as error:
            results.append({"id": candidate_id, "status": "failed", "error": _error(error)})
    valid = [item for item in results if item["status"] == "ok"]
    if valid:
        try:
            frame = query([compiled[item["id"]]["expression"] for item in valid])
            for item in valid:
                columns[item["id"]] = column(frame, compiled[item["id"]]["expression"], item["value"]["candidate"]["formula"])
        except Exception:
            # A genuine Qlib error for one expression must not discard siblings.
            for item in valid:
                try:
                    expression = compiled[item["id"]]["expression"]
                    columns[item["id"]] = column(query([expression]), expression, item["value"]["candidate"]["formula"])
                except Exception as error:
                    candidate_id = item["id"]
                    columns.pop(candidate_id, None)
                    item.clear()
                    item.update({"id": candidate_id, "status": "failed", "error": _error(error)})

    target = layout["target"]
    field, horizon = target["field"], target["horizonBars"]
    if target["kind"] == "provided":
        label_expression = "$" + field
    elif target["kind"] == "forward_return":
        label_expression = f"Sub(Div(Ref(${field},-{horizon}),${field}),1)"
    elif target["kind"] == "forward_volatility":
        label_expression = f"Ref(Std(Sub(Div(${field},Ref(${field},1)),1),{horizon}),-{horizon})"
    else:
        raise DataError("Unknown target construction")
    labels = column(query([label_expression]), label_expression)
    # Development feedback cannot consume labels extending into holdout.
    labels = [value if key["barIndex"] + horizon < len(calendar) and (partition != "development" or utc(calendar[key["barIndex"] + horizon]["time"]) <= end) else None for key, value in zip(keys, labels)]

    writer = Writer(request["outputDir"], limits)
    matrix_file = writer.matrix("matrix", snapshot["id"], partition, keys, columns)
    labels_file = writer.matrix("labels", snapshot["id"], partition, keys, {"target": labels})
    auxiliary = {"covariates": None, "sensitivityMatrix": None, "sensitivity": []}
    diagnostics = request.get("diagnostics")
    if diagnostics is not None:
        exact(diagnostics, ("covariateFields", "sensitivity"), "compute diagnostics")
        diagnostic_work = len(diagnostics["covariateFields"]) + sum(len(spec["neighbors"]) for spec in diagnostics["sensitivity"])
        if diagnostic_work > (limits or {}).get("maxDiagnosticWork", 10000):
            raise DataError("Auxiliary computation exceeds the registered diagnostic budget")
        covariates = {}
        for field in dict.fromkeys(diagnostics["covariateFields"]):
            if field not in snapshot["fields"]:
                continue
            try:
                expression = validate_and_compile({"dsl": "qlib-expr/1", "tree": {"field": field}}, {"fields": snapshot["fields"]})["expression"]
                covariates[field] = column(query([expression]), expression)
            except Exception:
                continue
        if covariates:
            local = writer.matrix("covariates", snapshot["id"], partition, keys, covariates)
            auxiliary["covariates"] = _shards(local)
        neighbors, neighbor_columns = {}, set()
        for specification in diagnostics["sensitivity"]:
            exact(specification, ("candidateId", "argumentPath", "neighbors"), "sensitivity request")
            metadata = {"candidateId": specification["candidateId"], "argumentPath": specification["argumentPath"], "neighbors": []}
            for neighbor in specification["neighbors"]:
                exact(neighbor, ("value", "column", "formula"), "sensitivity neighbor")
                metadata["neighbors"].append({"value": neighbor["value"], "column": neighbor["column"]})
                if neighbor["column"] in neighbor_columns:
                    raise DataError("Sensitivity columns must be unique")
                neighbor_columns.add(neighbor["column"])
                try:
                    expression = validate_and_compile(neighbor["formula"], {"fields": snapshot["fields"]})["expression"]
                    neighbors[neighbor["column"]] = column(query([expression]), expression, neighbor["formula"])
                except Exception:
                    continue
            auxiliary["sensitivity"].append(metadata)
        if neighbors:
            local = writer.matrix("sensitivity", snapshot["id"], partition, keys, neighbors)
            auxiliary["sensitivityMatrix"] = _shards(local)
    values_id = "values-" + digest_json({"snapshotId": snapshot["id"], "partition": partition, "candidates": results, "engine": engine, "diagnostics": diagnostics})[7:31]
    return {"values": {"id": values_id, "snapshotId": snapshot["id"], "partition": partition, "candidates": results, "engine": engine}, "matrix": matrix_file, "labels": labels_file, "diagnosticValues": auxiliary}


def _shards(local):
    manifest = read_json(local)
    return {"manifest": local, "digest": manifest["rowOrderDigest"], "rows": manifest["rows"], "bytes": local["bytes"] + sum(shard["bytes"] for shard in manifest["shards"])}
