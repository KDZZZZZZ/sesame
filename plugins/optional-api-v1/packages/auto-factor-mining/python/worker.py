"""One bounded command per real host process; no host or model dependency."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from formula import canonical_json, digest_json


def require(condition, message, code=None):
    if not condition:
        error = ValueError(message)
        if code:
            error.code = code
        raise error


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = canonical_json(value).encode("utf-8")
    path.write_bytes(data)
    return {"path": str(path.resolve()), "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def local_json(handle):
    return read_json(handle["path"])


def matrix(handle):
    if "manifest" in handle:
        handle = handle["manifest"]
    value = local_json(handle)
    require(value["schema"] == "factor-matrix/1", "Expected factor matrix")
    keys, columns = [], {name: [] for name in value["columns"]}
    for shard in value["shards"]:
        part = local_json(shard)
        require(set(part["columns"]) == set(columns), "Matrix columns differ")
        for name, items in part["columns"].items():
            require(len(items) == len(part["keys"]), "Matrix lengths differ")
            columns[name].extend(items)
        keys.extend(part["keys"])
    require(len(keys) == value["rows"] and digest_json(keys) == value["rowOrderDigest"], "Matrix row identity differs")
    require(len({(k["symbol"], k["barIndex"]) for k in keys}) == len(keys), "Duplicate matrix keys")
    return keys, columns


def evaluate_command(data, limits):
    module = importlib.import_module("evaluate")
    values = local_json(data["values"])
    keys, factors = matrix(values["matrix"])
    label_keys, labels = matrix(values["labels"])
    require(keys == label_keys and list(labels) == ["target"], "Labels do not align")
    references = {}
    for index, item in enumerate(data["referenceValues"]):
        reference = local_json(item)
        ref_keys, ref_columns = matrix(reference["matrix"])
        require(ref_keys == keys and reference["snapshotId"] == values["snapshotId"] and reference["partition"] == values["partition"], "Reference evidence does not align")
        references.update({str(index) + ":" + name: numbers for name, numbers in ref_columns.items()})
    auxiliary = values["diagnosticValues"]
    decoded = {"covariates": None, "sensitivityMatrix": None, "sensitivity": auxiliary["sensitivity"]}
    for name in ["covariates", "sensitivityMatrix"]:
        if auxiliary[name] is not None:
            aux_keys, columns = matrix(auxiliary[name])
            require(keys == aux_keys, "Diagnostic values do not align")
            decoded[name] = columns
    profile = dict(data["profile"])
    admitted, skipped, remaining = [], [], limits["maxDiagnosticWork"]
    for diagnostic in profile["diagnostics"]:
        work = len(keys) * max(1, len(factors)) * diagnostic.get("repetitions", 1)
        if work > remaining:
            skipped.append({"kind": diagnostic["kind"], "status": "incomplete", "evidence": None, "reason": "Diagnostic work budget exhausted"})
        else:
            remaining -= work
            admitted.append(diagnostic)
    profile["diagnostics"] = admitted
    results = module.evaluate(keys, factors, labels["target"], references, profile, decoded)
    output = []
    for item in results:
        if item["status"] != "ok":
            output.append(item)
            continue
        value = item["value"]
        candidate_id = item["id"]
        value["diagnostics"].extend(skipped)
        if any(d["required"] and any(s["kind"] == d["kind"] for s in skipped) for d in data["profile"]["diagnostics"]):
            if value["eligibility"] != "invalid":
                value["eligibility"] = "insufficient"
            value["reasons"].append("Required diagnostics exceed the available work budget")
        evaluation_id = "evaluation_" + digest_json([candidate_id, values["id"], data["context"], values["partition"], value])[7:]
        directory = Path(data["outputDir"]) / evaluation_id
        value["details"] = write_json(directory / "details.json", value["details"])
        for index, diagnostic in enumerate(value["diagnostics"]):
            if diagnostic["evidence"] is not None:
                diagnostic["evidence"] = write_json(directory / ("diagnostic-" + str(index) + ".json"), diagnostic["evidence"])
        value.update({"id": evaluation_id, "candidateId": candidate_id, "valuesId": values["id"], "valuesRef": data["valuesRef"], "context": data["context"], "profile": data["profile"], "partition": values["partition"]})
        output.append({"id": candidate_id, "status": "ok", "value": value})
    return {"evaluations": output}


def main(request_path, result_path):
    root = Path(request_path).resolve().parent
    command = None
    try:
        request = read_json(request_path)
        require(set(request) == {"schema", "command", "limits", "input"} and request["schema"] == "factor-worker/1", "Unknown worker envelope")
        command, data, limits = request["command"], request["input"], request["limits"]
        require(set(limits) == {"maxInputBytes", "maxOutputBytes", "timeoutMs", "maxDiagnosticWork"}, "Unknown execution limits")
        require(all(isinstance(n, int) and n > 0 for n in limits.values()), "Invalid worker budget")
        input_bytes, seen = Path(request_path).stat().st_size, set()
        require(input_bytes <= limits["maxInputBytes"], "Inline request exceeds the input byte budget", "BUDGET_EXHAUSTED")

        def inspect(value):
            nonlocal input_bytes
            if isinstance(value, dict) and set(value) == {"path", "digest", "bytes"}:
                original = Path(value["path"])
                path = original.resolve()
                require(path.is_relative_to(root) and path.is_file() and not original.is_symlink(), "File outside attempt root")
                if path in seen:
                    return
                seen.add(path)
                content = path.read_bytes()
                require(len(content) == value["bytes"] and "sha256:" + hashlib.sha256(content).hexdigest() == value["digest"], "File byte identity differs")
                input_bytes += len(content)
                require(input_bytes <= limits["maxInputBytes"], "Input byte budget exceeded", "BUDGET_EXHAUSTED")
                if path.suffix == ".json":
                    inspect(read_json(path))
            elif isinstance(value, dict):
                for item in value.values():
                    inspect(item)
            elif isinstance(value, list):
                for item in value:
                    inspect(item)

        inspect(data)
        output_dir = Path(data["outputDir"]).resolve()
        require(output_dir.is_relative_to(root), "Output outside attempt root")
        output_dir.mkdir(parents=True, exist_ok=True)
        if command == "propose":
            require(set(data) == {"request", "checkpoint", "feedback", "limit", "outputDir"}, "Unknown search input")
            output = importlib.import_module("search").propose(data["request"], local_json(data["checkpoint"]) if data["checkpoint"] else None, data["feedback"], data["limit"])
            output["checkpoint"] = write_json(output_dir / "checkpoint.json", output["checkpoint"])
        elif command in ("prepare", "compute"):
            module = importlib.import_module("compute")
            output = getattr(module, command)(data, limits)
        elif command == "evaluate":
            require(set(data) == {"values", "referenceValues", "profile", "context", "valuesRef", "outputDir"}, "Unknown evaluation input")
            output = evaluate_command(data, limits)
        else:
            raise ValueError("Unknown worker command")
        output_bytes = sum(p.stat().st_size for p in output_dir.rglob("*") if p.is_file())
        result = {"schema": "factor-worker/1", "command": command, "status": "ok", "output": output, "error": None}
        require(output_bytes + len(canonical_json(result).encode("utf-8")) <= limits["maxOutputBytes"], "Output including its receipt exceeds the byte budget", "BUDGET_EXHAUSTED")
    except Exception as exc:
        result = {"schema": "factor-worker/1", "command": command, "status": "failed", "output": None, "error": {"code": getattr(exc, "code", "WORKER_FAILED"), "message": str(exc)[:2000], "retryable": False}}
    write_json(result_path, result)
    print(json.dumps({"command": command, "status": result["status"]}, separators=(",", ":")))


if __name__ == "__main__":
    require(len(sys.argv) == 3, "Expected request and result paths")
    main(sys.argv[1], sys.argv[2])
