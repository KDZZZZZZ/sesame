import sys, json, os, re
from html.parser import HTMLParser

VERSION = "2.0.1"
PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))

def resolve_path(p):
    target = os.path.realpath(os.path.join(PLUGIN_ROOT, p))
    if os.path.isabs(p) or os.path.commonpath([PLUGIN_ROOT, target]) != PLUGIN_ROOT:
        raise ValueError("file_path must be relative to the plugin package")
    return target

class WebExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.text_parts = []
        self.links = []
        self.in_title = False
        self.in_skip = 0
        self.skip_tags = {"script", "style", "nav", "footer", "header", "aside"}
        self.current_tag = None
        self.meta_description = ""

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        attrs_dict = dict(attrs)
        if tag in self.skip_tags:
            self.in_skip += 1
        if tag == "a" and "href" in attrs_dict:
            href = attrs_dict["href"]
            if href.startswith("http"):
                self.links.append(href)
        if tag == "meta" and attrs_dict.get("name", "").lower() == "description":
            self.meta_description = attrs_dict.get("content", "")
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag in self.skip_tags:
            self.in_skip -= 1
        if tag == "title":
            self.in_title = False
        self.current_tag = None

    def handle_data(self, data):
        if self.in_skip > 0:
            return
        stripped = data.strip()
        if not stripped:
            return
        if self.in_title:
            self.title += stripped
        else:
            self.text_parts.append(stripped)

    def get_result(self):
        text = " ".join(self.text_parts)
        text = re.sub(r'\s+', ' ', text).strip()
        return {
            "title": self.title,
            "text": text,
            "text_preview": text[:300],
            "text_length": len(text),
            "links": list(dict.fromkeys(self.links))[:50],
            "meta_description": self.meta_description,
            "word_count": len(text.split()) if text else 0,
            "link_count": len(self.links)
        }

def extract_webpage(args):
    content = args.get("html_content", "")
    file_path = args.get("file_path", "")
    if not content and file_path:
        try:
            with open(resolve_path(file_path), "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            return {"error": str(e), "version": VERSION}
    if not content:
        return {"error": "No HTML content provided", "version": VERSION}

    extractor = WebExtractor()
    try:
        extractor.feed(content)
        result = extractor.get_result()
        result["version"] = VERSION
        result["source"] = file_path if file_path else "inline"
        return result
    except Exception as e:
        return {"error": str(e), "version": VERSION}

TOOLS = [
    {
        "name": "extract_webpage",
        "description": "Extract title, text, links and metadata from HTML content (inline or bundled file path)",
        "inputSchema": {
            "type": "object",
            "properties": {
                "html_content": {"type": "string", "description": "Raw HTML string"},
                "file_path": {"type": "string", "description": "Relative path to a bundled HTML file; cannot access conversation or host files"}
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
            result = {"serverInfo": {"name": "web-extract", "version": VERSION}, "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "private"}
        elif method == "initialize":
            result = {"protocolVersion": "2025-11-25", "serverInfo": {"name": "web-extract", "version": VERSION}, "capabilities": {"tools": {}}}
        elif method == "tools/list":
            result = {"tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}
        elif method == "tools/call" and req["params"]["name"] == "extract_webpage":
            data = extract_webpage(req["params"]["arguments"])
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "structuredContent": data, "isError": "error" in data}
        if result is None:
            response = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method or tool not found"}}
        else:
            result["resultType"] = "complete"
            response = {"jsonrpc": "2.0", "id": req["id"], "result": result}
    except Exception as error:
        response = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32602, "message": str(error)}}
    print(json.dumps(response, ensure_ascii=False), flush=True)
