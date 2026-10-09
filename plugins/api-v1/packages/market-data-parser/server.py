import sys, json, os
import xml.etree.ElementTree as ET

VERSION = "2.0.1"
PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))

def resolve_path(p):
    target = os.path.realpath(os.path.join(PLUGIN_ROOT, p))
    if os.path.isabs(p) or os.path.commonpath([PLUGIN_ROOT, target]) != PLUGIN_ROOT:
        raise ValueError("file_path must be relative to the plugin package")
    return target

def read_input(args, content_key):
    content = args.get(content_key, "")
    file_path = args.get("file_path", "")
    if not content and file_path:
        with open(resolve_path(file_path), "r", encoding="utf-8") as f:
            content = f.read()
    return content, file_path

def parse_fx_json(args):
    try:
        content, file_path = read_input(args, "json_content")
        if not content:
            return {"error": "No JSON content provided", "version": VERSION}
        data = json.loads(content)
        if not isinstance(data, dict) or not isinstance(data.get("rates"), dict) or not isinstance(data.get("base"), str) or not data["base"]:
            raise ValueError("Expected exchangerate JSON with base and rates")
        codes = args.get("codes", [])
        rates = data.get("rates", {})
        if codes:
            rates = {c: rates[c] for c in codes if c in rates}
        return {
            "format": "exchangerate-json",
            "provider": data.get("provider", ""),
            "base": data.get("base", ""),
            "date": data.get("date", ""),
            "total_currencies": len(data.get("rates", {})),
            "returned_currencies": len(rates),
            "rates": rates,
            "source": file_path if file_path else "inline",
            "version": VERSION
        }
    except Exception as e:
        return {"error": str(e), "version": VERSION}

def parse_fx_xml(args):
    try:
        content, file_path = read_input(args, "xml_content")
        if not content:
            return {"error": "No XML content provided", "version": VERSION}
        root = ET.fromstring(content)
        if root.tag != "Tarih_Date":
            raise ValueError("Expected TCMB Tarih_Date XML")
        date_attr = root.get("Date") or root.get("Tarih") or ""
        bulletin = root.get("Bulten_No", "")
        codes = [c.upper() for c in args.get("codes", [])]
        currencies = []
        for cur in root.findall("Currency"):
            code = cur.get("CurrencyCode") or cur.get("Kod") or ""
            if codes and code.upper() not in codes:
                continue
            currencies.append({
                "code": code,
                "name": (cur.findtext("CurrencyName") or "").strip(),
                "unit": cur.findtext("Unit", default=""),
                "forex_buying": cur.findtext("ForexBuying", default=""),
                "forex_selling": cur.findtext("ForexSelling", default="")
            })
        return {
            "format": "tcmb-xml",
            "date": date_attr,
            "bulletin_no": bulletin,
            "total_currencies": len(root.findall("Currency")),
            "returned_currencies": len(currencies),
            "currencies": currencies,
            "source": file_path if file_path else "inline",
            "version": VERSION
        }
    except ET.ParseError as e:
        return {"error": "XML parse error: %s" % e, "version": VERSION}
    except Exception as e:
        return {"error": str(e), "version": VERSION}

TOOLS = [
    {
        "name": "parse_fx_json",
        "description": "Parse exchangerate-api style JSON (base, date, rates) with optional currency filter",
        "inputSchema": {
            "type": "object",
            "properties": {
                "json_content": {"type": "string", "description": "Raw JSON string"},
                "file_path": {"type": "string", "description": "Relative path to a bundled JSON file; cannot access conversation or host files"},
                "codes": {"type": "array", "items": {"type": "string"}, "description": "Optional currency code filter, e.g. [\"EUR\",\"JPY\"]"}
            }
        }
    },
    {
        "name": "parse_fx_xml",
        "description": "Parse TCMB style daily FX XML (date, bulletin, currencies) with optional code filter",
        "inputSchema": {
            "type": "object",
            "properties": {
                "xml_content": {"type": "string", "description": "Raw XML string"},
                "file_path": {"type": "string", "description": "Relative path to a bundled XML file; cannot access conversation or host files"},
                "codes": {"type": "array", "items": {"type": "string"}, "description": "Optional currency code filter, e.g. [\"USD\",\"EUR\"]"}
            }
        }
    }
]

for line in sys.stdin:
    try:
        req = json.loads(line)
        method = req.get("method")
        result = None
        if "id" not in req:
            continue
        if method == "server/discover":
            result = {"serverInfo": {"name": "market-data-parser", "version": VERSION}, "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "private"}
        elif method == "initialize":
            result = {"protocolVersion": "2025-11-25", "serverInfo": {"name": "market-data-parser", "version": VERSION}, "capabilities": {"tools": {}}}
        elif method == "tools/list":
            result = {"tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}
        elif method == "tools/call":
            name = req["params"]["name"]
            if name == "parse_fx_json":
                data = parse_fx_json(req["params"]["arguments"])
            elif name == "parse_fx_xml":
                data = parse_fx_xml(req["params"]["arguments"])
            else:
                data = None
            if data is not None:
                result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "structuredContent": data, "isError": "error" in data}
        if result is None:
            response = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method or tool not found"}}
        else:
            result["resultType"] = "complete"
            response = {"jsonrpc": "2.0", "id": req["id"], "result": result}
    except Exception as error:
        response = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32602, "message": str(error)}}
    print(json.dumps(response, ensure_ascii=False), flush=True)
