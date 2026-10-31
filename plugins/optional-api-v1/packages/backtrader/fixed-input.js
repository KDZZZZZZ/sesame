import { readArtifact, readEntry } from './resource-files.js';
import { check, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';

export async function fixedRows(host, ref, columns = {}) {
  const artifact = await readArtifact(host,ref),
    content = artifact.manifest.content;
  check(
    ref.kind === "data" && content.format === "json-rows",
    "Fixed json-rows DataRef required",
  );
  const blob = artifact.manifest.blobs.find(
    (blob) => blob.path === content.path,
  );
  check(
    blob && blob.size <= 16 * 1024 * 1024,
    "Input blob absent or exceeds 16MiB",
  );
  const rows = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readEntry(host,ref,blob.path),
    ),
  );
  check(
    Array.isArray(rows) &&
      rows.length === content.rowCount &&
      rows.length >= 2 &&
      rows.length <= 100000,
    "Input row count mismatch or budget exceeded",
  );
  check(
    ["demo", "observed", "derived", "user_input"].includes(
      content.provenance?.kind,
    ),
    "Input provenance is required",
  );
  let prior = -Infinity;
  const mapped = rows.map((row) => {
    let time = row[columns.datetime ?? "datetime"];
    if (time?.basis === "utc") {
      check(Number.isSafeInteger(time.unixMs), "Invalid source UTC time");
      time = new Date(time.unixMs).toISOString();
    }
    check(
      typeof time === "string" &&
        /(Z|[+-]\d\d:\d\d)$/.test(time) &&
        Number.isFinite(Date.parse(time)),
      "Only explicit UTC/offset timestamps; no wall-clock inference",
    );
    const at = Date.parse(time);
    check(at > prior, "Fixed input times must strictly increase");
    prior = at;
    const prices = Object.fromEntries(
      ["open", "high", "low", "close", "volume"].map((key) => [
        key,
        decimal(row[columns[key] ?? key]),
      ]),
    );
    check(
      Decimal.compare(prices.high, prices.low) >= 0 &&
        ["open", "close"].every(
          (key) =>
            Decimal.compare(prices[key], prices.low) >= 0 &&
            Decimal.compare(prices[key], prices.high) <= 0,
        ) &&
        Decimal.compare(prices.volume, "0") >= 0,
      "Invalid fixed OHLCV",
    );
    return { datetime: new Date(at).toISOString(), ...prices };
  });
  return { rows: mapped, origin: content.provenance.kind };
}
