import { check, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { intervals } from './history.js';

const unknown = (reason) => ({ status: "unknown", reason }),
  value = (value) => ({ status: "value", value });
export function displayDecimals(row) {
  const precision = row.precision?.price;
  let digits;
  if (row.precisionMode === 2 && Number.isInteger(precision)) {
    digits = precision;
  } else if (row.precisionMode === 4) {
    const tick = decimal(
      typeof precision === "number" ? String(precision) : precision,
    );
    check(
      Decimal.compare(tick, "0") > 0,
      "Invalid source precision",
      "SOURCE_DATA_INVALID",
    );
    digits = (tick.split(".")[1] ?? "").length;
  } else {
    check(
      false,
      "Market has no reliable fixed display precision; significant-digit modes are unsupported",
      "UNSUPPORTED_CAPABILITY",
    );
  }
  check(
    digits >= 0 && digits <= 20,
    "Display precision exceeds supported 20 decimal places",
    "UNSUPPORTED_CAPABILITY",
  );
  return digits;
}
export function instrumentSummary(binding, row) {
  return {
    ref: { sourceId: binding.sourceId, instrumentId: row.symbol },
    symbol: row.symbol,
    name: row.symbol,
    assetClass: "crypto",
    venue: value(binding.exchange),
  };
}

export async function searchInstruments(provider, input, context) {
  const binding = provider.bound(context);
  return provider.page(input, context, async () => {
    const result = await provider.call(context, "markets");
    return {
      items: result.rows
        .map((row) => provider.summary(binding, row))
        .filter(
          (item) =>
            item.symbol.toLowerCase().includes(input.query.toLowerCase()) &&
            (!input.assetClasses || input.assetClasses.includes("crypto")) &&
            (!input.venues || input.venues.includes(binding.exchange)),
        ),
      meta: provider.meta(result),
    };
  });
}

export async function describeInstrument(provider, input, context) {
  const binding = provider.bound(context, input.instrument),
    result = await provider.call(context, "markets"),
    row = result.rows.find(
      (row) => row.symbol === input.instrument.instrumentId,
    );
  check(row, "Unknown public spot market", "NOT_FOUND");
  return {
    data: {
      ...provider.summary(binding, row),
      currency: value(row.quote),
      price: {
        tickSize: unknown(
          "CCXT precision mode is not a fixed tick guarantee",
        ),
        displayDecimals: displayDecimals(row),
      },
      quantity: {
        unit: row.base,
        min: unknown("No executable broker quantity guarantee"),
        max: unknown("No executable broker quantity guarantee"),
        step: unknown("No fixed lot step verified"),
        contractMultiplier: unknown("No derivative contract"),
      },
      volume: { realUnit: value(row.base), hasReal: true, hasTick: false },
      timeBasis: { kind: "utc" },
      calendar: unknown("No fixed exchange calendar"),
      features: {
        timeframes: Object.keys(intervals),
        priceBases: ["last"],
        adjustments: ["none"],
      },
      native: { symbol: row.id, market: binding.exchange },
    },
    meta: provider.meta(result),
  };
}
