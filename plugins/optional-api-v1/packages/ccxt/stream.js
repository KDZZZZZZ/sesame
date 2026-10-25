import { randomUUID } from 'node:crypto';
import { check } from '@sesame/plugin-sdk/protocol';
import { intervals, sourceLimits } from './history.js';

export const POLL_INTERVAL = 1000;

export async function subscribeBars(provider, input, context) {
  const controller = new AbortController(),
    signal = AbortSignal.any([
      controller.signal,
      ...(context.signal ? [context.signal] : []),
    ]);
  check(
    !input.resumeToken,
    "Requires new snapshot",
    "UNSUPPORTED_CAPABILITY",
  );
  check(
    Number.isInteger(input.tailLimit) &&
      input.tailLimit > 0 &&
      input.tailLimit <= 500,
    "tailLimit must be 1..500",
  );
  const read = async (tail = input.tailLimit) => {
    const duration = intervals[input.spec.timeframe],
      open = Math.floor(Date.now() / duration) * duration,
      result = await provider.queryBars(
        {
          ...input,
          direction: "backward",
          range: {
            from: {
              basis: "utc",
              // One extra source candle proves closure when the caller only
              // wants completed bars, including a tail of a single bar.
              unixMs: open - (tail - 1 + (input.includeForming === false ? 1 : 0)) * duration,
            },
            to: {
              basis: "utc",
              unixMs: open + duration,
            },
          },
          page: { limit: 500 },
        },
        { ...context, signal },
      );
    return {
      seriesId: result.data.seriesId,
      instrument: input.instrument,
      spec: input.spec,
      bars: result.data.page.items.slice(-input.tailLimit),
      coverage: result.data.coverage,
      meta: result.meta,
    };
  };
  const snapshot = await read();
  if (snapshot.bars.length < input.tailLimit) {
    // Native caps can leave room for fewer than tailLimit candles, especially
    // when the newest candle is needed only as proof of its predecessor's close.
    // At most one older page fills that initial tail; live ticks stay read(3).
    const requested = snapshot.coverage.requested,
      duration = intervals[input.spec.timeframe],
      cap = sourceLimits[provider.bound(context).exchange],
      to = snapshot.bars[0]?.openTime ?? {
        basis: "utc",
        unixMs: Math.max(requested.from.unixMs, requested.to.unixMs - cap * duration),
      };
    if (requested.from.unixMs < to.unixMs) {
      const earlier = await provider.queryBars({
        ...input, direction: "backward",
        range: { from: requested.from, to },
        page: { limit: input.tailLimit - snapshot.bars.length },
      }, { ...context, signal });
      snapshot.bars = [...earlier.data.page.items, ...snapshot.bars].slice(-input.tailLimit);
      snapshot.coverage = {
        ...snapshot.coverage,
        observedRange: snapshot.bars.length
          ? { from: snapshot.bars[0].openTime, to: snapshot.bars.at(-1).endTime }
          : null,
      };
    }
  }
  const position = { streamId: randomUUID(), epoch: randomUUID(), seq: "0" };
  let timer,
    task,
    prior = snapshot,
    seq = 0n,
    started = false;
  const handle = {
    bindingId: context.bindingId,
    snapshot,
    position,
    consistency: "bounded",
    recovery: "snapshot",
    ready: (emit) => {
      if (started || signal.aborted) return;
      started = true;
      const tick = () => {
        task = (async () => {
          try {
            // Refresh only the forming candle and its predecessor. The
            // configured worker retains its markets and HTTP session.
            const next = await read(3);
            if (signal.aborted) return;
            const last = prior.bars.at(-1)?.openTime.unixMs;
            check(
              last === undefined || !next.bars.length ||
                next.bars[0].openTime.unixMs <= last + intervals[input.spec.timeframe],
              "Latest source window no longer overlaps; refresh the snapshot",
              "GAP_DETECTED",
            );
            const old = new Map(
                prior.bars.map((bar) => [bar.id, bar.revision]),
              ),
              bars = next.bars.filter(
                (bar) => old.get(bar.id) !== bar.revision,
              );
            if (bars.length)
              emit({
                ...position,
                seq: String(++seq),
                eventId: randomUUID(),
                schemaVersion: "1.0.0",
                type: "bars.upsert",
                payload: { seriesId: next.seriesId, bars },
                observedAt: Date.now(),
              });
            // An empty read does not confirm removal of observed candles.
            // Retain the last nonempty window to detect gaps on recovery.
            if (next.bars.length) prior = next;
          } catch (error) {
            if (!signal.aborted)
              emit({
                ...position,
                seq: String(++seq),
                eventId: randomUUID(),
                schemaVersion: "1.0.0",
                type: "stream.gap",
                payload: {
                  reason: {
                    code: error.code ?? "SOURCE_UNAVAILABLE",
                    message: error.message,
                  },
                  recovery: "snapshot",
                },
                observedAt: Date.now(),
              });
            controller.abort();
          } finally {
            if (!signal.aborted) {
              timer = setTimeout(tick, POLL_INTERVAL);
              timer.unref?.();
            }
          }
        })();
      };
      timer = setTimeout(tick, POLL_INTERVAL);
      timer.unref?.();
    },
    close: async () => {
      controller.abort();
      clearTimeout(timer);
      await task;
      signal.removeEventListener("abort", abort);
      provider.streams.delete(handle);
    },
  };
  const abort = () => clearTimeout(timer);
  signal.addEventListener("abort", abort, { once: true });
  provider.streams.add(handle);
  return handle;
}
