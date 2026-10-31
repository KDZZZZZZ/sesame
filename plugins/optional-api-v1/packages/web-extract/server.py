import sys, json, os, re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

PLUGIN_ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(PLUGIN_ROOT, "plugin.json"), encoding="utf-8") as manifest:
    VERSION = json.load(manifest)["version"]

def resolve_path(p):
    target = os.path.realpath(os.path.join(PLUGIN_ROOT, p))
    if os.path.isabs(p) or os.path.commonpath([PLUGIN_ROOT, target]) != PLUGIN_ROOT:
        raise ValueError("file_path must be relative to the plugin package")
    return target

class WebExtractor(HTMLParser):
    def __init__(self, source_url=""):
        super().__init__()
        self.title = ""
        self.text_parts = []
        self.links = []
        self.in_title = False
        self.in_skip = False
        self.elements = []
        self.skip_tags = {"script", "style", "nav", "footer", "header", "aside", "ix:hidden"}
        self.void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
        self.current_tag = None
        self.meta_description = ""
        self.source_url = source_url

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        attrs_dict = dict(attrs)
        style = attrs_dict.get("style") or ""
        hidden = tag in self.skip_tags or "hidden" in attrs_dict or bool(re.search(r'(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important\s*)?(?:;|$)', style, re.I))
        skipped = self.in_skip or hidden
        if tag not in self.void_tags:
            self.elements.append((tag, self.in_skip))
            self.in_skip = skipped
        if tag == "a" and isinstance(attrs_dict.get("href"), str) and not skipped:
            href = urljoin(self.source_url, attrs_dict["href"])
            if urlsplit(href).scheme in ("http", "https"):
                self.links.append(href)
        if tag == "meta" and not skipped and (attrs_dict.get("name") or "").lower() == "description":
            self.meta_description = attrs_dict.get("content") or ""
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        for index in range(len(self.elements) - 1, -1, -1):
            if self.elements[index][0] == tag:
                self.in_skip = self.elements[index][1]
                del self.elements[index:]
                break
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

    extractor = WebExtractor(args.get("_source_url", ""))
    try:
        extractor.feed(content)
        extractor.close()
        result = extractor.get_result()
        result["version"] = VERSION
        result["source"] = file_path if file_path else "inline"
        return result
    except Exception as e:
        return {"error": str(e), "version": VERSION}


if __name__ == "__main__":
    functions = {"extract_webpage": extract_webpage}
    with open(sys.argv[2], encoding="utf-8") as request:
        arguments = json.load(request)
    result = functions[sys.argv[1]](arguments)
    with open(sys.argv[3], "w", encoding="utf-8") as response:
        json.dump(result, response, ensure_ascii=False)
