import sys, json, os, re
import xml.etree.ElementTree as ET

VERSION = "2.0.2"
PLUGIN_ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))

def resolve_path(p):
    target = os.path.realpath(os.path.join(PLUGIN_ROOT, p))
    if os.path.isabs(p) or os.path.commonpath([PLUGIN_ROOT, target]) != PLUGIN_ROOT:
        raise ValueError("file_path must be relative to the plugin package")
    return target

def strip_html(s):
    if not s:
        return ""
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def parse_feed(args):
    content = args.get("xml_content", "")
    file_path = args.get("file_path", "")
    max_entries = args.get("max_entries", 10)
    if not content and file_path:
        try:
            with open(resolve_path(file_path), "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            return {"error": str(e), "version": VERSION}
    if not content:
        return {"error": "No XML content provided", "version": VERSION}

    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        return {"error": "XML parse error: %s" % e, "version": VERSION}

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    tag = root.tag.lower()

    if tag == "{http://www.w3.org/2005/atom}feed":
        fmt = "atom"
        feed_title = strip_html(root.findtext("atom:title", default="", namespaces=ns))
        feed_updated = root.findtext("atom:updated", default="", namespaces=ns)
        entry_nodes = root.findall("atom:entry", ns)
        entries = []
        for e in entry_nodes:
            link = ""
            for l in e.findall("atom:link", ns):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            if not link and e.findall("atom:link", ns):
                link = e.findall("atom:link", ns)[0].get("href", "")
            content_el = e.find("atom:content", ns)
            summary_el = e.find("atom:summary", ns)
            raw = ""
            if content_el is not None and content_el.text:
                raw = content_el.text
            elif summary_el is not None and summary_el.text:
                raw = summary_el.text
            entries.append({
                "title": strip_html(e.findtext("atom:title", default="", namespaces=ns)),
                "link": link,
                "published": e.findtext("atom:published", default="", namespaces=ns) or e.findtext("atom:updated", default="", namespaces=ns),
                "id": e.findtext("atom:id", default="", namespaces=ns),
                "content_snippet": strip_html(raw)[:300]
            })
    elif tag == "rss":
        fmt = "rss"
        channel = root.find("channel")
        if channel is None:
            return {"error": "RSS channel not found", "version": VERSION}
        feed_title = strip_html(channel.findtext("title", default=""))
        feed_updated = channel.findtext("lastBuildDate", default="") or channel.findtext("pubDate", default="")
        entry_nodes = channel.findall("item")
        entries = []
        for e in entry_nodes:
            entries.append({
                "title": strip_html(e.findtext("title", default="")),
                "link": e.findtext("link", default=""),
                "published": e.findtext("pubDate", default=""),
                "id": e.findtext("guid", default=""),
                "content_snippet": strip_html(e.findtext("description", default=""))[:300]
            })
    else:
        return {"error": "Unrecognized feed format: %s" % tag, "version": VERSION}

    return {
        "format": fmt,
        "feed_title": feed_title,
        "feed_updated": feed_updated,
        "entry_count": len(entries),
        "entries": entries[:max_entries],
        "source": file_path if file_path else "inline",
        "version": VERSION
    }

TOOLS = [
    {
        "name": "parse_feed",
        "description": "Parse RSS 2.0 or Atom XML feed (inline content or bundled file path) into entries",
        "inputSchema": {
            "type": "object",
            "properties": {
                "xml_content": {"type": "string", "description": "Raw RSS/Atom XML string"},
                "file_path": {"type": "string", "description": "Relative path to a bundled XML file; cannot access conversation or host files"},
                "max_entries": {"type": "integer", "default": 10, "minimum": 1, "maximum": 100}
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
            result = {"serverInfo": {"name": "rss-collect", "version": VERSION}, "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "private"}
        elif method == "initialize":
            result = {"protocolVersion": "2025-11-25", "serverInfo": {"name": "rss-collect", "version": VERSION}, "capabilities": {"tools": {}}}
        elif method == "tools/list":
            result = {"tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}
        elif method == "tools/call" and req["params"]["name"] == "parse_feed":
            data = parse_feed(req["params"]["arguments"])
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "structuredContent": data, "isError": "error" in data}
        if result is None:
            response = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method or tool not found"}}
        else:
            result["resultType"] = "complete"
            response = {"jsonrpc": "2.0", "id": req["id"], "result": result}
    except Exception as error:
        response = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32602, "message": str(error)}}
    print(json.dumps(response, ensure_ascii=False), flush=True)
