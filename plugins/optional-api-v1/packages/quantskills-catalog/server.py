"""Offline references and deduplicated Sesame workflows (Python standard library)."""
import json
from pathlib import Path
import sys

PLUGIN_ROOT = Path(__file__).resolve().parent
VERSION = json.loads((PLUGIN_ROOT / "plugin.json").read_text(encoding="utf-8"))["version"]
CATALOG = json.loads((PLUGIN_ROOT / "catalog.json").read_text(encoding="utf-8"))
ITEMS = CATALOG["items"]
CATEGORIES = CATALOG["categories"]
TOOLS = json.loads((PLUGIN_ROOT / "tools.json").read_text(encoding="utf-8"))["analysis"]
ROUTES = json.loads((PLUGIN_ROOT / "workflows.json").read_text(encoding="utf-8"))["workflows"]

def text_arg(args, key, required=False):
    value = args.get(key, "")
    if not isinstance(value, str) or len(value) > 2000 or (required and not value.strip()):
        raise ValueError(f"{key} must be a {'nonempty ' if required else ''}string of at most 2000 characters")
    return value.strip()

def limit_arg(args, default, maximum):
    value = args.get("limit", default)
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f"limit must be an integer from 1 to {maximum}")
    return value

def brief(item):
    return {key: item.get(key, "") for key in (
        "name", "repo_url", "category", "subcategory", "stage", "asset_type", "verification_level"
    )}

def handle_search(args):
    query = text_arg(args, "query", required=True).lower()
    limit = limit_arg(args, 20, 100)
    results = [brief(item) for item in ITEMS
               if query in item.get("name", "").lower() or query in item.get("description", "").lower()][:limit]
    return {"results": results, "count": len(results), "query": query, "version": VERSION}

def handle_filter(args):
    limit = limit_arg(args, 50, 1000)
    filters = {key: text_arg(args, key) for key in ("category", "stage", "asset_type", "verification_level")}
    results = [brief(item) for item in ITEMS if all(not value or item.get(key) == value
               for key, value in filters.items())][:limit]
    return {"results": results, "count": len(results), "filters": args, "version": VERSION}

def handle_list_categories(args):
    return {"categories": CATEGORIES, "total_items": len(ITEMS), "version": VERSION}

def handle_get_item(args):
    name = text_arg(args, "name", required=True)
    for item in ITEMS:
        if item["name"] == name:
            return {"found": True, "item": item, "version": VERSION}
    return {"found": False, "name": name, "version": VERSION}

def handle_recommend(args):
    need = text_arg(args, "need", required=True)
    if need not in ROUTES:
        raise ValueError("Unknown need; use one of: " + ", ".join(ROUTES))
    route = ROUTES[need]
    # Routing metadata cannot establish runtime/install/license/publication status.
    return {
        "need": need, "workflow": route,
        "references": [brief(item) for item in ITEMS if item["name"] in route["reference_names"]],
        "availability": "not_checked",
        "next_steps": [
            "Use plugin_discover to inspect installed plugins and plugin_catalog to verify exact published IDs and versions.",
            "Choose only the required method package and backend. Install or update explicitly through plugin_install_catalog, then plugin_load and verify prerequisites.",
            "Read the selected SKILL and retain its sources; directory references are not imported implementations or proof of trading performance."
        ],
        "snapshot_date": CATALOG["meta"]["snapshot_date"], "version": VERSION
    }

HANDLERS = {
    "catalog_search": handle_search, "catalog_filter": handle_filter,
    "catalog_list_categories": handle_list_categories, "catalog_get_item": handle_get_item,
    "catalog_recommend": handle_recommend,
}

def dispatch(req):
    if not isinstance(req, dict):
        raise ValueError("Request must be an object")
    if "id" not in req:
        return None
    method = req.get("method")
    if method in ("initialize", "server/discover"):
        result = {"serverInfo": {"name": "quantskills-catalog", "version": VERSION}, "capabilities": {"tools": {}}}
        if method == "initialize":
            result["protocolVersion"] = "2025-11-25"
        else:
            result.update(ttlMs=0, cacheScope="private")
    elif method == "tools/list":
        result = {"tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}
    elif method == "tools/call":
        params = req.get("params", {})
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        handler = HANDLERS.get(params.get("name"))
        if handler is None:
            return {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Tool not found"}}
        args = params.get("arguments", {})
        if not isinstance(args, dict):
            raise ValueError("arguments must be an object")
        data = handler(args)
        result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                  "structuredContent": data, "isError": False}
    else:
        return {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method not found"}}
    result["resultType"] = "complete"
    return {"jsonrpc": "2.0", "id": req["id"], "result": result}

def main():
    for line in sys.stdin:
        req = None
        try:
            req = json.loads(line)
            response = dispatch(req)
        except Exception as error:
            response = {"jsonrpc": "2.0", "id": req.get("id") if isinstance(req, dict) else None,
                        "error": {"code": -32602, "message": str(error)}}
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
