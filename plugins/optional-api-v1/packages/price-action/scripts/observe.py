"""Original finite Price Action observation subset, not a Brooks implementation."""
from bar_input import observation, require, run_cli, validate_rows, validate_source


def observe(rows, source, left=2, right=2):
    require(type(left) is int and type(right) is int and 1 <= left <= 20 and 1 <= right <= 20,
            "INVALID_INPUT: left/right must be integers 1..20")
    source = validate_source(source)
    prices = validate_rows(rows)
    events, latest = [], {}
    params = {"left": left, "right": right, "ties": "no-pivot", "break": "strict-close", "anchor": "latest-confirmed"}
    for t in range(len(rows)):
        pivot = t - right
        if pivot >= left:
            others = [i for i in range(pivot - left, t + 1) if i != pivot]
            for side in ["high", "low"]:
                level = prices[pivot][side]
                extreme = all(level > prices[i][side] for i in others) if side == "high" else all(level < prices[i][side] for i in others)
                if extreme:
                    anchors = list(range(pivot - left, t + 1))
                    event = observation("price-action", "pivot-" + side, rows, source, pivot, t, anchors, params,
                                        {"level": rows[pivot][side], "pivot_bar": rows[pivot]["id"]})
                    events.append(event)
                    latest[side] = (pivot, level, event, anchors)
        for side in ["high", "low"]:
            if side not in latest:
                continue
            pivot, level, confirmed, anchors = latest[side]
            broken = prices[t]["close"] > level if side == "high" else prices[t]["close"] < level
            if broken:
                # Include every intervening bar as evidence this is the first close beyond the anchor.
                evidence = list(range(anchors[0], t + 1))
                events.append(observation("price-action", "close-break-" + ("up" if side == "high" else "down"),
                                          rows, source, t, t, evidence, params,
                                          {"level": rows[pivot][side], "pivot_observation_id": confirmed["id"],
                                           "pivot_confirmed_at": confirmed["confirmed_at"]}))
                del latest[side]
    return events


if __name__ == "__main__":
    run_cli(observe, windows=True)
