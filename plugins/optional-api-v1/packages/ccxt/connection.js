import { records } from './records.js';
import { runWorker } from './worker-call.js';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';

// The provider owns binding state; these operations preserve exact persisted routes.
export function bindConnection(provider, input, context) {
  const supplied = input.configuration !== undefined;
  let configuration;
  if (supplied) {
    configuration = input.configuration;
    check(
      configuration &&
        typeof configuration === "object" &&
        !Array.isArray(configuration) &&
        Object.keys(configuration).every((key) =>
          ["exchange", "publicProxy"].includes(key),
        ),
      "configuration accepts only exchange and publicProxy; unknown fields never fall back to direct",
      "INVALID_ARGUMENT",
    );
    check(
      ["kraken", "coinbase", "okx"].includes(configuration.exchange),
      "Select an explicit supported public exchange",
      "INVALID_ARGUMENT",
    );
    if (Object.hasOwn(configuration, "publicProxy")) {
      check(
        typeof configuration.publicProxy === "string" &&
          configuration.publicProxy.length > 0,
        "publicProxy must be a nonempty credential-free HTTP(S) URL",
        "INVALID_ARGUMENT",
      );
      let parsed;
      try {
        parsed = new URL(configuration.publicProxy);
      } catch {
        check(false, "Invalid explicit publicProxy URL", "INVALID_ARGUMENT");
      }
      check(
        ["http:", "https:"].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password &&
          !parsed.search &&
          !parsed.hash &&
          parsed.pathname === "/",
        "publicProxy must be HTTP(S) without credentials, query, fragment or proxy path",
        "INVALID_ARGUMENT",
      );
    }
  } else {
    check(
      input.connection &&
        typeof input.connection.id === "string" &&
        typeof input.connection.revision === "string",
      "Provide explicit configuration first or an exact previously saved connection",
      "PREREQUISITE_REQUIRED",
    );
    const saved = records(provider.host).get(
      "public_connections",
      digest(input.connection),
      true,
    );
    check(
      saved && canonical(saved.connection) === canonical(input.connection),
      "Exact public connection configuration is unavailable; explicitly bind the authorized route",
      "CONNECTION_CHANGED",
    );
    configuration = saved.configuration;
    // Stored data is plugin-private but still validated before any request.
    return provider.bind(
      { configuration, connection: input.connection },
      context,
    );
  }
  const exchange = configuration.exchange,
    proxy = configuration.publicProxy ?? null;
  const connection = {
    id: `ccxt:${exchange}`,
    revision: proxy
      ? digest({ library: "4.5.85", publicProxy: proxy })
      : "4.5.85",
  };
  check(
    !input.connection ||
      canonical(input.connection) === canonical(connection),
    "Exact connection does not identify this authorized public route",
    "CONNECTION_CHANGED",
  );
  const id = digest(connection),
    saved = records(provider.host).get("public_connections", id, true);
  const frozen = { exchange, ...(proxy ? { publicProxy: proxy } : {}) };
  check(
    !saved || canonical(saved.configuration) === canonical(frozen),
    "Stored public route identity conflicts",
    "CONNECTION_CHANGED",
  );
  if (!saved)
    records(provider.host).put("public_connections", {
      id,
      connection,
      configuration: frozen,
    });
  provider.bindings.set(context.bindingId, {
    exchange,
    proxy,
    connection,
    sourceId: `ccxt:${exchange}:spot`,
  });
  return {
    connection,
    sourceId: `ccxt:${exchange}:spot`,
    health: "configured",
    limitations: [
      "Public network read and compatible dependency must succeed before data is available.",
      "Exact public route persists in private plugin storage; connection-only bindings never guess or switch it.",
    ],
  };
}

export function boundConnection(provider, context, ref) {
  const binding = provider.bindings.get(context.bindingId);
  check(binding, "Binding is closed", "CONNECTION_CHANGED");
  if (ref)
    check(
      ref.sourceId === binding.sourceId &&
        typeof ref.instrumentId === "string",
      "Instrument belongs to another explicit exchange",
      "INSTRUMENT_MISMATCH",
    );
  return binding;
}

export async function readConnection(provider, context, action, args = {}) {
  const binding = provider.bound(context);
  const result = await runWorker(provider.host, {
      exchange: binding.exchange,
      publicProxy: binding.proxy,
      action,
      ...args,
    },
    { signal: context.signal, timeoutMs: 60000 },
  );
  provider.bound(context);
  check(
    result.library === "4.5.85" &&
      result.exchange === binding.exchange &&
      Number.isSafeInteger(result.observedAt),
    "Invalid public source receipt",
    "SOURCE_DATA_INVALID",
  );
  return result;
}

export function sourceMetadata(result) {
  return {
    observedAt: result.observedAt,
    freshness: "unknown",
    origin: "observed",
    consistency: "best_effort",
    warnings: [
      {
        code: "PUBLIC_OHLCV",
        message:
          "Exchange public OHLCV is delayed/partial. CCXT floats become decimal text; lost upstream precision cannot be recovered.",
      },
    ],
    source: {
      library: "ccxt",
      version: result.library,
      exchange: result.exchange,
    },
  };
}
