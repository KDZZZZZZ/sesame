"""Bounded, development-only proposal search with replayable JSON state.

DEAP manipulates typed trees; it never compiles or evaluates caller text.
Optuna studies are private, in-memory instances rebuilt from ordered asks/tells.
The worker owns checkpoint file IO. This module receives and returns JSON only.
"""

import copy
import hashlib
import importlib.metadata
import math
import platform
import random
from contextlib import contextmanager

import optuna
from deap import base, gp, tools

from formula import OPERATORS, OPERATOR_DIGEST, canonical_json, digest_json, validate_and_compile

SCHEMA = "factor-search-state/1"
VERSION = 1
MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024
MAX_POPULATION = 64
ROLLING = frozenset(("Mean", "Std", "Min", "Max", "Sum", "Rank"))
METHODS = frozenset(("seed", "template", "random", "deap", "optuna"))


class SearchError(ValueError):
    def __init__(self, message, code="INVALID_SEARCH"):
        super().__init__(message)
        self.code = code


def _require(condition, message, code="INVALID_SEARCH"):
    if not condition:
        raise SearchError(message, code)


def _keys(value, expected):
    _require(isinstance(value, dict) and set(value) == set(expected),
             "Expected exactly: " + ", ".join(expected))


def _integer(value, low, high):
    _require(isinstance(value, int) and not isinstance(value, bool) and low <= value <= high,
             f"Expected an integer in {low}..{high}")


def _text(value, limit):
    _require(isinstance(value, str) and value.strip() and len(value) <= limit,
             f"Expected nonempty text of at most {limit} characters")


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _bytes(value):
    return len(canonical_json(value).encode("utf-8"))


def _seed(seed, purpose):
    return int(hashlib.sha256(f"{seed}:{purpose}".encode("utf-8")).hexdigest()[:8], 16)


def _engines():
    return {"python": platform.python_version(),
            "deap": importlib.metadata.version("deap"),
            "optuna": importlib.metadata.version("optuna"),
            "numpy": importlib.metadata.version("numpy"),
            "scipy": importlib.metadata.version("scipy"),
            "operatorDigest": OPERATOR_DIGEST}


def _validate_request(request):
    _keys(request, ("requestId", "need", "development", "space", "profile", "references", "budget"))
    _text(request["requestId"], 128)
    _text(request["need"], 8000)
    development = request["development"]
    _keys(development, ("snapshotId", "source", "layout", "fields", "calendarDigest"))
    _text(development["snapshotId"], 256)
    _keys(development["source"], ("id", "revision", "digest", "kind", "schemaVersion"))
    _keys(development["layout"], ("universe", "frequency", "timezone", "availableAt", "development", "target"))
    _require(development["layout"]["availableAt"] == "bar_close", "Search requires bar-close availability")
    _require(isinstance(development["fields"], list), "Development fields must be declared")
    target = development["layout"]["target"]
    _require(isinstance(target, dict), "Target metadata must be an object")
    _keys(target, ("kind", "field", "scale", "horizonBars") if target.get("kind") == "provided"
          else ("kind", "field", "horizonBars"))
    space = request["space"]
    _keys(space, ("fields", "operators", "windows", "lags", "constants", "maxNodes", "maxDepth", "maxLookbackBars", "seeds", "templates"))
    for key in ("fields", "operators", "windows", "lags", "constants", "seeds", "templates"):
        _require(isinstance(space[key], list) and len(space[key]) <= 64, f"{key} must be a bounded array")
    _require(space["fields"] and all(field in development["fields"] for field in space["fields"]),
             "Search fields must belong to frozen development metadata")
    if target["kind"] == "provided":
        _require(target["field"] not in space["fields"], "Provided labels cannot be search features")
    _require(all(op in OPERATORS for op in space["operators"]), "Unknown search operator")
    for value in space["windows"] + space["lags"]:
        _integer(value, 1, 10000)
    _require(all(_finite(value) and abs(value) <= 1e12 for value in space["constants"]), "Invalid scalar constants")
    for name, maximum in (("maxNodes", 128), ("maxDepth", 12), ("maxLookbackBars", 10000)):
        _integer(space[name], 1, maximum)
    # The shared compiler is the authority for field names and operator policy.
    for field in space["fields"]:
        validate_and_compile({"dsl": "qlib-expr/1", "tree": {"field": field}}, space)
    for template in space["templates"]:
        _validate_template(template, space)
    _keys(request["profile"], ("id", "version", "kind", "axis", "minPairs", "minCoverage", "stabilityWindows",
                              "maxReferenceCorrelation", "score", "diagnostics"))
    diagnostics = request["profile"]["diagnostics"]
    _require(isinstance(diagnostics, list) and len(diagnostics) <= 6, "Diagnostics must be bounded metadata")
    options = {"placebo": ("blockBars", "seed", "confidence"), "bootstrap": ("blockBars", "seed", "confidence"),
               "walk_forward": ("foldBars",), "regimes": ("field", "bins"),
               "sensitivity": ("argumentPath", "neighbors"), "quantiles": ("count",)}
    for diagnostic in diagnostics:
        _require(isinstance(diagnostic, dict) and diagnostic.get("kind") in options, "Unknown diagnostic metadata")
        keys = ("kind", "required", "options", "repetitions") if "repetitions" in diagnostic else ("kind", "required", "options")
        _keys(diagnostic, keys)
        _keys(diagnostic["options"], options[diagnostic["kind"]])
    _require(isinstance(request["references"], list) and len(request["references"]) <= 32, "References must be factor IDs")
    for reference in request["references"]:
        _text(reference, 128)
    budget = request["budget"]
    _keys(budget, ("maxCandidates", "batchSize", "maxWorkers", "maxSeconds", "maxInputBytes", "maxOutputBytes", "seed"))
    for key, low, high in (("maxCandidates", 1, 100000), ("batchSize", 1, 64), ("maxWorkers", 1, 16),
                           ("maxSeconds", 1, 86400), ("maxInputBytes", 1024, 512 * 1024 * 1024),
                           ("maxOutputBytes", 1024, 512 * 1024 * 1024), ("seed", 0, 2147483647)):
        _integer(budget[key], low, high)
    _require(_bytes(request) <= budget["maxInputBytes"], "Search request exceeds the declared input budget", "INPUT_BUDGET")


def _validate_template(template, space):
    _keys(template, ("tree", "domains"))
    domains = template["domains"]
    _require(isinstance(domains, dict) and len(domains) <= 16, "Template domains must be bounded")
    for name, choices in domains.items():
        _text(name, 64)
        _require(isinstance(choices, list) and 0 < len(choices) <= 64 and
                 all(_finite(value) and abs(value) <= 1e12 for value in choices), "Invalid template domain")
    used = set()
    count = 0

    def visit(node, depth):
        nonlocal count
        count += 1
        _require(count <= space["maxNodes"] and depth <= space["maxDepth"], "Template exceeds complexity limits")
        _require(isinstance(node, dict), "Template nodes must be typed objects")
        if set(node) == {"parameter"}:
            _require(isinstance(node["parameter"], str) and node["parameter"] in domains, "Undeclared template parameter")
            used.add(node["parameter"])
        elif set(node) == {"call", "args"}:
            _require(node["call"] in space["operators"] and isinstance(node["args"], list) and
                     len(node["args"]) == (1 if node["call"] in ("Abs", "Log") else 2), "Invalid template operator")
            for child in node["args"]:
                visit(child, depth + 1)
        else:
            _require(set(node) in ({"field"}, {"constant"}), "Invalid template node")

    visit(template["tree"], 1)
    _require(used == set(domains), "Every declared parameter must appear explicitly in the template")


def _instantiate(tree, parameters):
    if "parameter" in tree:
        return {"constant": parameters[tree["parameter"]]}
    if "call" in tree:
        return {"call": tree["call"], "args": [_instantiate(child, parameters) for child in tree["args"]]}
    return copy.deepcopy(tree)


# DEAP chooses a crossover type from a set. Stable hashes make its iteration
# order deterministic across fresh Python processes; versions are checkpointed.
class _StableType(type):
    def __hash__(cls):
        return {"Series": 101, "Scalar": 211, "Window": 307, "Lag": 401}[cls.__name__]


class Series(metaclass=_StableType):
    pass


class Scalar(metaclass=_StableType):
    pass


class Window(metaclass=_StableType):
    pass


class Lag(metaclass=_StableType):
    pass


class _Fitness(base.Fitness):
    weights = (1.0,)


class _Individual(gp.PrimitiveTree):
    def __init__(self, content, candidate_id, score):
        super().__init__(content)
        self.candidate_id = candidate_id
        self.fitness = _Fitness((score,))


def _unevaluated(*_args):
    raise SearchError("Search primitives must never evaluate market data")


class _Grammar:
    def __init__(self, space):
        self.space = space
        self.pset = gp.PrimitiveSetTyped("factor", [], Series)
        self.operations = {}
        self.terminals = {}
        for kind, values in ((Series, [{"field": name} for name in space["fields"]]),
                             (Scalar, [{"constant": value} for value in space["constants"]]),
                             (Window, [{"constant": value} for value in space["windows"]]),
                             (Lag, [{"constant": value} for value in space["lags"]])):
            for index, value in enumerate(values):
                name = f"{kind.__name__}_{index}"
                self.terminals[name] = value
                self.pset.addTerminal(value, kind, name=name)
        for op in space["operators"]:
            if op in ("Abs", "Log"):
                signatures = [(Series,)]
            elif op == "Ref":
                signatures = [(Series, Lag)] if space["lags"] else []
            elif op in ROLLING:
                signatures = [(Series, Window)] if space["windows"] else []
            else:
                signatures = [(Series, Series)]
                if space["constants"]:
                    signatures += [(Series, Scalar), (Scalar, Series)]
            for signature in signatures:
                name = op + "_" + "_".join(kind.__name__ for kind in signature)
                self.pset.addPrimitive(_unevaluated, list(signature), Series, name=name)
                self.operations[name] = op

    def generate(self, kind=Series, depth=None, nodes=None):
        depth = min(self.space["maxDepth"], 4) if depth is None else depth
        nodes = self.space["maxNodes"] if nodes is None else nodes
        primitives = [item for item in self.pset.primitives.get(kind, []) if item.arity < nodes]
        if depth <= 1 or not primitives or random.random() < 0.25:
            return [random.choice(self.pset.terminals[kind])]
        primitive = random.choice(primitives)
        result = [primitive]
        available = nodes - 1
        for position, child_type in enumerate(primitive.args):
            remaining_children = len(primitive.args) - position - 1
            allocation = available - remaining_children
            child = self.generate(child_type, depth - 1, allocation)
            result.extend(child)
            available -= len(child)
        return result

    def from_formula(self, formula):
        def visit(node, kind=Series):
            if "call" not in node:
                return [gp.Terminal(copy.deepcopy(node), False, kind)]
            op = node["call"]
            signature = tuple(Lag if op == "Ref" and index == 1 else
                              Window if op in ROLLING and index == 1 else
                              Scalar if "constant" in child else Series
                              for index, child in enumerate(node["args"]))
            name = op + "_" + "_".join(child_type.__name__ for child_type in signature)
            result = [self.pset.mapping[name]]
            for child, child_type in zip(node["args"], signature):
                result.extend(visit(child, child_type))
            return result
        return gp.PrimitiveTree(visit(formula["tree"]))

    def to_formula(self, individual):
        nodes = iter(individual)

        def visit():
            node = next(nodes)
            if node.arity == 0:
                return copy.deepcopy(self.terminals[node.value] if isinstance(node.value, str) else node.value)
            return {"call": self.operations[node.name], "args": [visit() for _ in range(node.arity)]}

        return {"dsl": "qlib-expr/1", "tree": visit()}


@contextmanager
def _random_state(seed):
    previous = random.getstate()
    random.seed(seed)
    try:
        yield
    finally:
        random.setstate(previous)


def _scores(state):
    return {item["value"]["candidateId"]: item["value"]["developmentScore"]
            for item in state["feedback"] if item["disposition"] == "accepted"
            and item["value"]["status"] == "valid" and item["value"]["developmentScore"] is not None}


def _population(state):
    scores = _scores(state)
    rejected = {item["value"]["candidateId"] for item in state["feedback"] if item["disposition"] == "accepted"
                and (item["value"]["status"] != "valid" or item["value"]["developmentScore"] is None)}
    proposals = [attempt for attempt in state["attempts"] if attempt["status"] == "proposed"
                 and attempt["candidateId"] not in rejected]
    proposals.sort(key=lambda item: (scores.get(item["candidateId"], -1e308), item["sequence"]), reverse=True)
    return [attempt["candidateId"] for attempt in proposals[:MAX_POPULATION]]


def _update_budget(state, request):
    statuses = [item["status"] for item in state["attempts"]]
    state["budget"] = {"used": len(statuses), "proposed": statuses.count("proposed"),
                       "failed": statuses.count("failed"), "duplicates": statuses.count("duplicate"),
                       "remaining": request["budget"]["maxCandidates"] - len(statuses)}
    state["population"] = _population(state)
    if state["budget"]["remaining"] == 0:
        state["exhausted"], state["stopReason"] = True, "candidate_budget"


def _new_state(request):
    state = {"schema": SCHEMA, "version": VERSION, "requestDigest": digest_json(request),
             "engines": _engines(), "seed": request["budget"]["seed"], "attempts": [],
             "feedback": [], "events": [], "population": [], "budget": {},
             "exhausted": False, "stopReason": None}
    _update_budget(state, request)
    return state


def _validate_feedback(value):
    _keys(value, ("candidateId", "evaluationId", "developmentScore", "status", "reasons"))
    _text(value["candidateId"], 128)
    _text(value["evaluationId"], 256)
    _require(value["developmentScore"] is None or _finite(value["developmentScore"]), "Feedback scores must be finite or null")
    _require(value["status"] in ("valid", "invalid"), "Unknown feedback status")
    _require(isinstance(value["reasons"], list) and len(value["reasons"]) <= 32, "Feedback reasons must be bounded")
    for reason in value["reasons"]:
        _text(reason, 2000)
    _require(_bytes(value) <= 16384, "Feedback item exceeds 16 KiB")


def _validate_state(state, request):
    _keys(state, ("schema", "version", "requestDigest", "engines", "seed", "attempts", "feedback", "events", "population", "budget", "exhausted", "stopReason"))
    _require(state["schema"] == SCHEMA and state["version"] == VERSION, "Unsupported checkpoint version", "CHECKPOINT_VERSION")
    _require(state["engines"] == _engines(), "Checkpoint engine versions changed; create a new search branch", "CHECKPOINT_VERSION")
    _require(state["requestDigest"] == digest_json(request) and state["seed"] == request["budget"]["seed"],
             "Checkpoint belongs to a different frozen request", "CHECKPOINT_REQUEST")
    _require(isinstance(state["attempts"], list) and len(state["attempts"]) <= request["budget"]["maxCandidates"], "Invalid attempt history")
    proposed = {}
    for index, attempt in enumerate(state["attempts"]):
        _keys(attempt, ("sequence", "method", "operation", "parents", "parameters", "formula", "candidateId", "definitionDigest", "status", "reason", "duplicateOf", "trial"))
        _require(attempt["sequence"] == index and attempt["method"] in METHODS, "Invalid attempt sequence/method")
        _require(attempt["status"] in ("proposed", "duplicate", "failed"), "Invalid attempt status")
        _require(isinstance(attempt["parents"], list) and all(parent in proposed for parent in attempt["parents"]), "Unknown genetic parent")
        _require(attempt["operation"] in ("mutation", "crossover") if attempt["method"] == "deap"
                 else attempt["operation"] is None, "Invalid structural operation")
        _require(len(attempt["parents"]) == ({"mutation": 1, "crossover": 2}.get(attempt["operation"], 0)), "Invalid parent count")
        _require(isinstance(attempt["parameters"], dict) and len(attempt["parameters"]) <= 16 and
                 all(_finite(value) for value in attempt["parameters"].values()), "Invalid proposal parameters")
        _require((attempt["method"] == "optuna") == (attempt["trial"] is not None), "Missing or unexpected Optuna trial")
        if attempt["status"] in ("proposed", "duplicate"):
            compiled = validate_and_compile(attempt["formula"], request["space"])
            _require(compiled["digest"] == attempt["definitionDigest"], "Checkpoint formula digest changed")
            identity = "c_" + compiled["digest"][7:]
            if attempt["status"] == "proposed":
                _require(attempt["candidateId"] == identity and identity not in proposed, "Invalid candidate identity")
                proposed[identity] = attempt
            else:
                _require(attempt["duplicateOf"] == identity and identity in proposed and attempt["candidateId"] is None,
                         "Invalid duplicate history")
        else:
            _require(attempt["candidateId"] is None and isinstance(attempt["reason"], str), "Invalid failure history")
        if attempt["trial"] is not None:
            _keys(attempt["trial"], ("templateIndex", "number"))
            _require(attempt["method"] == "optuna", "Only Optuna attempts can own trials")
    _require(isinstance(state["feedback"], list) and isinstance(state["events"], list), "Invalid checkpoint histories")
    evaluations, settled = set(), set()
    for index, item in enumerate(state["feedback"]):
        _keys(item, ("sequence", "value", "disposition"))
        _validate_feedback(item["value"])
        value = item["value"]
        _require(item["sequence"] == index and value["evaluationId"] not in evaluations, "Repeated checkpoint feedback identity")
        evaluations.add(value["evaluationId"])
        disposition = "unknown" if value["candidateId"] not in proposed else "late" if value["candidateId"] in settled else "accepted"
        # Unknown IDs may later coincide with a generated formula; they remain
        # ignored, because feedback cannot precede a reserved candidate.
        _require(item["disposition"] == disposition or item["disposition"] == "unknown", "Invalid feedback disposition")
        if item["disposition"] == "accepted":
            settled.add(value["candidateId"])
    previous_budget, previous_population = state["budget"], state["population"]
    previous_exhausted, previous_reason = state["exhausted"], state["stopReason"]
    _update_budget(state, request)
    _require(previous_budget == state["budget"] and previous_population == state["population"], "Checkpoint counters/population changed")
    _require(previous_exhausted is state["exhausted"] and previous_reason == state["stopReason"], "Invalid exhaustion state")
    _require(state["stopReason"] in (None, "candidate_budget", "checkpoint_bytes") and
             state["exhausted"] == (state["stopReason"] is not None), "Invalid checkpoint stop reason")


class _Studies:
    def __init__(self, request, state):
        self.request = request
        self.studies = {}
        self.trials = {}
        for event in state["events"]:
            _require(isinstance(event, dict) and event.get("kind") in ("ask", "tell"), "Invalid Optuna event")
            _integer(event.get("attempt"), 0, len(state["attempts"]) - 1)
            attempt = state["attempts"][event["attempt"]]
            _require(attempt["trial"] is not None, "Optuna event has no trial")
            if event["kind"] == "ask":
                _keys(event, ("kind", "attempt"))
                _require(event["attempt"] not in self.trials, "Repeated Optuna ask")
                trial, parameters = self.ask(attempt["trial"]["templateIndex"], event["attempt"])
                _require(trial.number == attempt["trial"]["number"] and parameters == attempt["parameters"],
                         "Optuna replay diverged from the recorded ask", "CHECKPOINT_REPLAY")
            else:
                _keys(event, ("kind", "attempt", "state", "value"))
                self.tell(event["attempt"], event["state"], event["value"])
        expected = {attempt["sequence"] for attempt in state["attempts"] if attempt["trial"] is not None}
        _require(expected == set(self.trials), "Optuna trial history is incomplete")
        accepted = {item["value"]["candidateId"]: item["value"] for item in state["feedback"] if item["disposition"] == "accepted"}
        for sequence in expected:
            attempt, owned = state["attempts"][sequence], self.trials[sequence]
            feedback = accepted.get(attempt["candidateId"])
            status, value = None, None
            if attempt["status"] != "proposed":
                status = "FAIL"
            elif feedback is not None:
                status = "COMPLETE" if feedback["status"] == "valid" and feedback["developmentScore"] is not None else "FAIL"
                value = feedback["developmentScore"] if status == "COMPLETE" else None
            _require(owned["state"] == status and owned["value"] == value, "Optuna outcome does not match terminal feedback", "CHECKPOINT_REPLAY")

    def study(self, index):
        _integer(index, 0, len(self.request["space"]["templates"]) - 1)
        _require(self.request["space"]["templates"][index]["domains"], "Optuna needs explicit template parameters")
        if index not in self.studies:
            sampler = optuna.samplers.TPESampler(seed=_seed(self.request["budget"]["seed"], f"template:{index}"), n_startup_trials=3)
            self.studies[index] = optuna.create_study(study_name=f"factor-template-{index}", direction="maximize", sampler=sampler)
        return self.studies[index]

    def ask(self, index, attempt):
        study = self.study(index)
        trial = study.ask()
        parameters = {name: trial.suggest_categorical(name, values)
                      for name, values in sorted(self.request["space"]["templates"][index]["domains"].items())}
        self.trials[attempt] = {"index": index, "trial": trial, "finished": False, "state": None, "value": None}
        return trial, parameters

    def tell(self, attempt, status, value):
        _require(attempt in self.trials and not self.trials[attempt]["finished"], "Optuna tell is missing its ask or already finished")
        _require(status in ("COMPLETE", "FAIL") and (_finite(value) if status == "COMPLETE" else value is None), "Invalid Optuna outcome")
        owned = self.trials[attempt]
        self.study(owned["index"]).tell(owned["trial"], values=value, state=optuna.trial.TrialState[status])
        owned.update(finished=True, state=status, value=value)


def _tell(state, studies, attempt, status, value):
    studies.tell(attempt["sequence"], status, value)
    state["events"].append({"kind": "tell", "attempt": attempt["sequence"], "state": status, "value": value})


def _feedback(state, feedback, studies):
    _require(isinstance(feedback, list), "Feedback must be an array")
    known = {item["value"]["evaluationId"]: item["value"] for item in state["feedback"]}
    settled = {item["value"]["candidateId"] for item in state["feedback"] if item["disposition"] == "accepted"}
    proposed = {item["candidateId"]: item for item in state["attempts"] if item["status"] == "proposed"}
    for value in feedback:
        _validate_feedback(value)
        if value["evaluationId"] in known:
            _require(known[value["evaluationId"]] == value, "Evaluation ID was reused with different feedback", "FEEDBACK_CONFLICT")
            continue
        candidate_id = value["candidateId"]
        disposition = "unknown" if candidate_id not in proposed else "late" if candidate_id in settled else "accepted"
        state["feedback"].append({"sequence": len(state["feedback"]), "value": copy.deepcopy(value), "disposition": disposition})
        known[value["evaluationId"]] = value
        if disposition != "accepted":
            continue
        settled.add(candidate_id)
        attempt = proposed[candidate_id]
        if attempt["trial"] is not None:
            success = value["status"] == "valid" and value["developmentScore"] is not None
            _tell(state, studies, attempt, "COMPLETE" if success else "FAIL", value["developmentScore"] if success else None)


def _method(request, state):
    position = len(state["attempts"])
    seeds, templates = request["space"]["seeds"], request["space"]["templates"]
    if position < len(seeds):
        return "seed", position
    position -= len(seeds)
    if position < len(templates):
        return "template", position
    position -= len(templates)
    if position == 0:
        return "random", None
    optimizable = [index for index, template in enumerate(templates) if template["domains"]]
    cycle = ["deap", "optuna", "random"] if optimizable else ["deap", "random"]
    method = cycle[(position - 1) % len(cycle)]
    if method == "optuna":
        count = sum(item["method"] == "optuna" for item in state["attempts"])
        return method, optimizable[count % len(optimizable)]
    return ("random" if method == "deap" and not state["population"] else method), None


def _attempt(request, state, grammar, studies):
    method, index = _method(request, state)
    sequence = len(state["attempts"])
    attempt = {"sequence": sequence, "method": method, "operation": None, "parents": [],
               "parameters": {}, "formula": None, "candidateId": None, "definitionDigest": None,
               "status": "failed", "reason": None, "duplicateOf": None, "trial": None}
    with _random_state(_seed(state["seed"], f"attempt:{sequence}")):
        if method == "seed":
            attempt["formula"] = copy.deepcopy(request["space"]["seeds"][index])
        elif method in ("template", "optuna"):
            template = request["space"]["templates"][index]
            if method == "optuna":
                trial, parameters = studies.ask(index, sequence)
                attempt["trial"] = {"templateIndex": index, "number": trial.number}
                state["events"].append({"kind": "ask", "attempt": sequence})
            else:
                parameters = {name: values[0] for name, values in sorted(template["domains"].items())}
            attempt["parameters"] = parameters
            attempt["formula"] = {"dsl": "qlib-expr/1", "tree": _instantiate(template["tree"], parameters)}
        elif method == "random":
            attempt["formula"] = grammar.to_formula(gp.PrimitiveTree(grammar.generate()))
        else:
            scores = _scores(state)
            selected = set(state["population"])
            population = [_Individual(grammar.from_formula(item["formula"]), item["candidateId"],
                                      scores.get(item["candidateId"], -1e308))
                          for item in state["attempts"] if item["candidateId"] in selected]
            parents = tools.selTournament(population, 2, tournsize=min(3, len(population)))
            crossover = len(population) > 1 and sum(item["method"] == "deap" for item in state["attempts"]) % 2 == 1
            first = gp.PrimitiveTree(parents[0])
            if crossover:
                first, _ = gp.cxOnePoint(first, gp.PrimitiveTree(parents[1]))
                attempt["operation"] = "crossover"
                attempt["parents"] = [parent.candidate_id for parent in parents]
            else:
                first, = gp.mutUniform(first, lambda pset, type_: grammar.generate(type_, min(3, request["space"]["maxDepth"])), grammar.pset)
                attempt["operation"] = "mutation"
                attempt["parents"] = [parents[0].candidate_id]
            attempt["formula"] = grammar.to_formula(first)
    try:
        compiled = validate_and_compile(attempt["formula"], request["space"])
        attempt["definitionDigest"] = compiled["digest"]
        identity = "c_" + compiled["digest"][7:]
        if any(item["candidateId"] == identity for item in state["attempts"]):
            attempt.update(status="duplicate", duplicateOf=identity, reason="formula_already_proposed")
        else:
            attempt.update(status="proposed", candidateId=identity)
    except ValueError as exc:
        attempt["reason"] = str(exc)[:512]
    state["attempts"].append(attempt)
    if attempt["trial"] is not None and attempt["status"] != "proposed":
        _tell(state, studies, attempt, "FAIL", None)
    _update_budget(state, request)
    return attempt


def _candidate(attempt, request):
    return {"id": attempt["candidateId"], "formula": copy.deepcopy(attempt["formula"]),
            "hypothesis": request["need"][:2000],
            "origin": {"method": attempt["method"], "parents": attempt["parents"][:],
                       "parameters": copy.deepcopy(attempt["parameters"])}}


def _reservation(request, state):
    """Upper bound for the next retained attempt plus its returned candidate.

    A DEAP operation can at most double the allowed tree size before validation.
    Seeds and templates are bounded by the worker's request byte limit, so their
    exact size is additionally reserved. Pending results retain 16 KiB apiece.
    """
    method, index = _method(request, state)
    tree_bytes = request["space"]["maxNodes"] * 256 * 2
    if method == "seed":
        tree_bytes = max(tree_bytes, _bytes(request["space"]["seeds"][index]))
    parameters = max((_bytes(template["domains"]) for template in request["space"]["templates"]), default=2)
    settled = {item["value"]["candidateId"] for item in state["feedback"] if item["disposition"] == "accepted"}
    pending = sum(attempt["status"] == "proposed" and attempt["candidateId"] not in settled for attempt in state["attempts"])
    return tree_bytes * 2 + parameters + 24000 + pending * 17000


def propose(request, checkpoint, feedback, limit):
    """Return candidates, a JSON checkpoint, and exhaustion within one work block.

    ``limit=0`` applies terminal feedback without proposing. Up to four attempts
    per requested candidate are made; failed and duplicate attempts all consume
    the same frozen maxCandidates budget. Repeating an old checkpoint and the
    same ordered feedback is deterministic, including across fresh processes.
    """
    _validate_request(request)
    _integer(limit, 0, 100000)
    _require(_bytes({"request": request, "checkpoint": checkpoint, "feedback": feedback, "limit": limit}) <=
             request["budget"]["maxInputBytes"], "Search input exceeds the declared input budget", "INPUT_BUDGET")
    state = _new_state(request) if checkpoint is None else copy.deepcopy(checkpoint)
    if checkpoint is not None:
        _validate_state(state, request)
    studies = _Studies(request, state)
    _feedback(state, feedback, studies)
    _update_budget(state, request)
    # A checkpoint must fit the next input too, including the frozen request.
    cap = min(request["budget"]["maxOutputBytes"], MAX_CHECKPOINT_BYTES,
              request["budget"]["maxInputBytes"] - _bytes(request) - 1024)
    _require(_bytes(state) + 64 <= cap, "Feedback/checkpoint exceeds the declared output budget", "CHECKPOINT_BUDGET")
    grammar = _Grammar(request["space"])
    candidate_limit = min(limit, request["budget"]["batchSize"])
    attempt_limit = min(state["budget"]["remaining"], candidate_limit * 4)
    candidates = []
    for _ in range(attempt_limit):
        if state["exhausted"] or len(candidates) >= candidate_limit:
            break
        output = {"candidates": candidates, "checkpoint": state, "exhausted": state["exhausted"]}
        if _bytes(output) + _reservation(request, state) > cap:
            state["exhausted"], state["stopReason"] = True, "checkpoint_bytes"
            break
        attempt = _attempt(request, state, grammar, studies)
        if attempt["status"] == "proposed":
            candidates.append(_candidate(attempt, request))
    result = {"candidates": candidates, "checkpoint": state, "exhausted": state["exhausted"]}
    _require(_bytes(result) <= cap, "Search result exceeds the declared output budget", "CHECKPOINT_BUDGET")
    return result
