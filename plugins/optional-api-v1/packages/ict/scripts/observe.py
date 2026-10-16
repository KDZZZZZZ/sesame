"""Original three-observation interval check; not a complete ICT model."""
from bar_input import observation, run_cli, source_time, validate_rows, validate_source


def observe(rows, source):
    source = validate_source(source)
    prices = validate_rows(rows)
    events = []
    for t in range(2, len(rows)):
        a, c = prices[t - 2], prices[t]
        if c["low"] > a["high"]:
            direction, lower, upper = "up", rows[t - 2]["high"], rows[t]["low"]
        elif c["high"] < a["low"]:
            direction, lower, upper = "down", rows[t]["high"], rows[t - 2]["low"]
        else:
            continue
        adjacent = all(source_time(rows[i]["end_time"]) == source_time(rows[i + 1]["datetime"])
                       for i in [t - 2, t - 1])
        events.append(observation("ict", "three-bar-separation-" + direction, rows, source, t, t,
                                  [t - 2, t - 1, t], {"touch": "not-separation"},
                                  {"lower": lower, "upper": upper, "adjacent_intervals": adjacent,
                                   "calendar_continuity": "not-established", "classification": "interval-observation-only",
                                   "institutional_orders": "not-observed"}))
    return events


if __name__ == "__main__":
    run_cli(observe)
