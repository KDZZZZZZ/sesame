import sys,json,os,re

VERSION = "2.0.2"
PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.join(PLUGIN_ROOT, "catalog.json")

def load_catalog():
    try:
        with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        return {"error": str(e), "items": [], "categories": []}

CATALOG = load_catalog()
ITEMS = CATALOG.get("items", [])
CATEGORIES = CATALOG.get("categories", [])

TOOLS = [
    {
        "name": "catalog_search",
        "description": "Search QuantSkills catalog by keyword in name or description",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keyword to search"},
                "limit": {"type": "integer", "default": 20, "maximum": 100}
            },
            "required": ["query"]
        }
    },
    {
        "name": "catalog_filter",
        "description": "Filter catalog by category, workflow stage, asset type, or verification level",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Category name (e.g. '02 因子研发工具箱')"},
                "stage": {"type": "string", "description": "Workflow stage (e.g. 'data-ingestion')"},
                "asset_type": {"type": "string", "description": "Asset type: skill, agent, template, infrastructure"},
                "verification_level": {"type": "string", "description": "Verification level: published_endpoint, pending_review, unknown"},
                "limit": {"type": "integer", "default": 50, "maximum": 214}
            }
        }
    },
    {
        "name": "catalog_list_categories",
        "description": "List all categories with counts",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "catalog_get_item",
        "description": "Get full details of a catalog item by name",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Exact item name (repo name)"}
            },
            "required": ["name"]
        }
    }
]

def handle_search(args):
    query = args.get("query", "").lower()
    limit = args.get("limit", 20)
    results = []
    for item in ITEMS:
        if query in item.get("name", "").lower() or query in item.get("description", "").lower():
            results.append({
                "name": item["name"],
                "repo_url": item["repo_url"],
                "category": item["category"],
                "subcategory": item["subcategory"],
                "stage": item["stage"],
                "asset_type": item.get("asset_type", ""),
                "verification_level": item.get("verification_level", "")
            })
            if len(results) >= limit:
                break
    return {"results": results, "count": len(results), "query": query, "version": VERSION}

def handle_filter(args):
    limit = args.get("limit", 50)
    results = []
    for item in ITEMS:
        match = True
        if "category" in args and args["category"] and item.get("category") != args["category"]:
            match = False
        if "stage" in args and args["stage"] and item.get("stage") != args["stage"]:
            match = False
        if "asset_type" in args and args["asset_type"] and item.get("asset_type") != args["asset_type"]:
            match = False
        if "verification_level" in args and args["verification_level"] and item.get("verification_level") != args["verification_level"]:
            match = False
        if match:
            results.append({
                "name": item["name"],
                "repo_url": item["repo_url"],
                "category": item["category"],
                "subcategory": item["subcategory"],
                "stage": item["stage"],
                "asset_type": item.get("asset_type", ""),
                "verification_level": item.get("verification_level", "")
            })
            if len(results) >= limit:
                break
    return {"results": results, "count": len(results), "filters": args, "version": VERSION}

def handle_list_categories(args):
    return {"categories": CATEGORIES, "total_items": len(ITEMS), "version": VERSION}

def handle_get_item(args):
    name = args.get("name", "")
    for item in ITEMS:
        if item["name"] == name:
            return {"found": True, "item": item, "version": VERSION}
    return {"found": False, "name": name, "version": VERSION}

for line in sys.stdin:
    try:
        req = json.loads(line)
        method = req.get("method")
        result = None
        if "id" not in req:
            continue
        if method == "server/discover":
            result = {"serverInfo": {"name": "quantskills-catalog", "version": VERSION}, "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "private"}
        elif method == "initialize":
            result = {"protocolVersion": "2025-11-25", "serverInfo": {"name": "quantskills-catalog", "version": VERSION}, "capabilities": {"tools": {}}}
        elif method == "tools/list":
            result = {"tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}
        elif method == "tools/call":
            tool_name = req["params"]["name"]
            tool_args = req["params"]["arguments"]
            if tool_name == "catalog_search":
                data = handle_search(tool_args)
            elif tool_name == "catalog_filter":
                data = handle_filter(tool_args)
            elif tool_name == "catalog_list_categories":
                data = handle_list_categories(tool_args)
            elif tool_name == "catalog_get_item":
                data = handle_get_item(tool_args)
            else:
                result = None
            if result is None and data is not None:
                result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "structuredContent": data, "isError": False}
        if result is None:
            response = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method or tool not found"}}
        else:
            result["resultType"] = "complete"
            response = {"jsonrpc": "2.0", "id": req["id"], "result": result}
    except Exception as error:
        response = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32602, "message": str(error)}}
    print(json.dumps(response, ensure_ascii=False), flush=True)
