import sys, json, os
import xml.etree.ElementTree as ET

PLUGIN_ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(PLUGIN_ROOT, "plugin.json"), encoding="utf-8") as manifest:
    VERSION = json.load(manifest)["version"]

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
        base = data.get("base") or data.get("base_code") if isinstance(data, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get("rates"), dict) or not isinstance(base, str) or not base:
            raise ValueError("Expected exchangerate JSON with base and rates")
        if data.get("result", "success") != "success":
            raise ValueError("Exchange-rate source reports an error: " + str(data.get("error-type", data.get("result"))))
        codes = [code.upper() for code in args.get("codes", [])]
        rates = data.get("rates", {})
        if codes:
            rates = {c: rates[c] for c in codes if c in rates}
        return {
            "format": "exchangerate-json",
            "provider": data.get("provider", ""),
            "base": base,
            "date": data.get("date") or data.get("time_last_update_utc", ""),
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


if __name__ == "__main__":
    functions = {"parse_fx_json": parse_fx_json, "parse_fx_xml": parse_fx_xml}
    with open(sys.argv[2], encoding="utf-8") as request:
        arguments = json.load(request)
    result = functions[sys.argv[1]](arguments)
    with open(sys.argv[3], "w", encoding="utf-8") as response:
        json.dump(result, response, ensure_ascii=False)
