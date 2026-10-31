import importlib.util
from pathlib import Path
import unittest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("catalog_server", PLUGIN_ROOT / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class UsageExamplesTest(unittest.TestCase):
    def test_distinct_existing_result_routes_use_real_non_retired_packages(self):
        expected = {
            "trade-results": "sesame/abu-trade-metrics",
            "parameter-evidence": "sesame/abu-parameter-search",
            "series-similarity": "sesame/abu-similarity",
        }
        for need, plugin_id in expected.items():
            result = SERVER.handle_recommend({"need": need})
            self.assertEqual(result["workflow"]["primary_plugins"], [plugin_id])
            self.assertEqual(result["availability"], "not_checked")
            self.assertFalse(result["selection_required"])
        self.assertIn("abu_trade_results_audit", SERVER.ROUTES["trade-results"]["selection"])
        self.assertIn("不运行策略或优化器", SERVER.ROUTES["parameter-evidence"]["selection"])
        self.assertIn("不是历史同类事件检索", SERVER.ROUTES["series-similarity"]["selection"])
        self.assertNotIn("sesame/abu-backtest-lab", str(SERVER.ROUTES))

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
