"""Typed, closed Qlib expression compiler. No caller text is evaluated here."""

import hashlib
import json
import math
import re

DSL = "qlib-expr/1"
OPERATORS = ("Add", "Sub", "Mul", "Div", "Abs", "Log", "Ref", "Mean", "Std", "Min", "Max", "Sum", "Rank")
ROLLING = frozenset(("Mean", "Std", "Min", "Max", "Sum", "Rank"))
FIELD_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
SAFETY_LIMITS = {"maxNodes": 128, "maxDepth": 12, "maxLookbackBars": 10000}
OPERATOR_POLICY = {
    "dsl": DSL,
    "version": 1,
    "operators": list(OPERATORS),
    "ref": "positive-grid-lag",
    "rolling": "positive-grid-window",
    "rank": "rolling-time-series-average-ties-percentile",
    "warmup": "complete-lookback-grid",
    "nonfinite": "null",
}


class FormulaError(ValueError):
    code = "INVALID_FORMULA"


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise FormulaError("Constants must be finite JSON numbers")
    if abs(value) > 1e12:
        raise FormulaError("Formula constants must have magnitude at most 1e12")
    return int(value) if value == int(value) else value


def canonical_json(value):
    """Sorted JSON with ECMAScript-compatible finite number serialization."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise FormulaError("Only finite JSON values are supported")
        # JSON numbers have ECMAScript binary64 semantics at the JS boundary.
        number = float(value) if isinstance(value, int) and abs(value) > 9007199254740991 else value
        if number == 0:
            return "0"
        raw = repr(number).lower()
        if "e" not in raw:
            return raw[:-2] if raw.endswith(".0") else raw
        coefficient, exponent = raw.split("e")
        exp = int(exponent)
        if -6 <= exp < 21:
            from decimal import Decimal
            return format(Decimal(raw), "f")
        if coefficient.endswith(".0"):
            coefficient = coefficient[:-2]
        return coefficient + "e" + ("+" if exp >= 0 else "-") + str(abs(exp))
    if isinstance(value, str):
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return "".join(f"\\u{ord(char):04x}" if 0xD800 <= ord(char) <= 0xDFFF else char for char in encoded)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return "{" + ",".join(canonical_json(key) + ":" + canonical_json(value[key]) for key in sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))) + "}"
    raise FormulaError("Only finite JSON values are supported")


def digest_json(value):
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


OPERATOR_DIGEST = digest_json(OPERATOR_POLICY)


def validate_and_compile(formula, space=None):
    """Return expression/lookback/digest after validating an entirely typed AST.

    A full Space restricts the search. Independent compute passes only
    ``{"fields": snapshot_fields}``, retaining the fixed safety ceilings.
    """
    if not isinstance(formula, dict) or set(formula) != {"dsl", "tree"} or formula["dsl"] != DSL:
        raise FormulaError("Expected the exact qlib-expr/1 formula shape")
    policy = space or {}
    if not isinstance(policy, dict):
        raise FormulaError("Formula policy must be an object")
    fields = policy.get("fields")
    if fields is not None and (not isinstance(fields, list) or not fields or any(not isinstance(field, str) or not FIELD_PATTERN.fullmatch(field) for field in fields)):
        raise FormulaError("Formula fields must be safe lowercase feature names")
    operators = policy.get("operators", OPERATORS)
    if not isinstance(operators, (list, tuple)) or any(op not in OPERATORS for op in operators):
        raise FormulaError("Unknown permitted operator")
    ceilings = {}
    for key, maximum in SAFETY_LIMITS.items():
        value = policy.get(key, maximum)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > maximum:
            raise FormulaError(f"{key} must be an integer in 1..{maximum}")
        ceilings[key] = value
    nodes = 0

    def visit(node, depth):
        nonlocal nodes
        nodes += 1
        if nodes > ceilings["maxNodes"] or depth > ceilings["maxDepth"]:
            raise FormulaError("Formula exceeds the node/depth budget")
        if not isinstance(node, dict):
            raise FormulaError("Every expression must be a typed object")
        if set(node) == {"field"}:
            field = node["field"]
            if not isinstance(field, str) or not FIELD_PATTERN.fullmatch(field) or fields is not None and field not in fields:
                raise FormulaError("Feature is absent from the frozen allowed fields")
            return "$" + field, 0, True
        if set(node) == {"constant"}:
            value = _number(node["constant"])
            if "constants" in policy and value not in policy["constants"]:
                raise FormulaError("Scalar constant is outside the declared search space")
            return canonical_json(value), 0, False
        if set(node) != {"call", "args"} or node["call"] not in operators or node["call"] not in OPERATORS:
            raise FormulaError("Only the declared typed operators are supported")
        op, args = node["call"], node["args"]
        arity = 1 if op in ("Abs", "Log") else 2
        if not isinstance(args, list) or len(args) != arity:
            raise FormulaError(f"{op} requires {arity} typed arguments")
        if op in ROLLING or op == "Ref":
            first, lookback, series = visit(args[0], depth + 1)
            nodes += 1
            if nodes > ceilings["maxNodes"] or depth + 1 > ceilings["maxDepth"]:
                raise FormulaError("Formula exceeds the node/depth budget")
            if not series or not isinstance(args[1], dict) or set(args[1]) != {"constant"}:
                raise FormulaError(f"{op} requires a series and a positive integer constant")
            length = _number(args[1]["constant"])
            if not isinstance(length, int) or not 1 <= length <= SAFETY_LIMITS["maxLookbackBars"]:
                raise FormulaError("Feature lags and windows must be integers in 1..10000")
            choices = policy.get("lags" if op == "Ref" else "windows")
            if choices is not None and length not in choices:
                raise FormulaError("Lag/window is outside the declared search space")
            lookback += length if op == "Ref" else length - 1
            result = f"{op}({first},{length})", lookback, True
        else:
            values = [visit(arg, depth + 1) for arg in args]
            if not any(value[2] for value in values):
                raise FormulaError("An operator must consume a feature series")
            result = f"{op}({','.join(value[0] for value in values)})", max(value[1] for value in values), True
        if result[1] > ceilings["maxLookbackBars"]:
            raise FormulaError("Formula exceeds the lookback budget")
        return result

    expression, lookback, series = visit(formula["tree"], 1)
    if not series:
        raise FormulaError("A factor must produce a feature series")
    identity = {"dsl": DSL, "operatorDigest": OPERATOR_DIGEST, "tree": formula["tree"]}
    return {"expression": expression, "lookback": lookback, "digest": digest_json(identity)}
