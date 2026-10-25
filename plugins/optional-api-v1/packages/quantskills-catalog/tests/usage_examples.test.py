import importlib.util
from pathlib import Path
import unittest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("catalog_server", PLUGIN_ROOT / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class UsageExamplesTest(unittest.TestCase):
    def test_model_visible_examples_match_mcp_responses(self):
        for capability in SERVER.DECLARED_CAPABILITIES:
            for example in capability.get("usage", {}).get("examples", []):
                with self.subTest(capability=capability["id"]):
                    response = SERVER.dispatch({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": capability["binding"]["name"],
                            "arguments": example["input"],
                        },
                    })
                    self.assertFalse(response["result"]["isError"])
                    self.assertEqual(
                        response["result"]["structuredContent"],
                        example["output"],
                    )


if __name__ == "__main__":
    unittest.main()
