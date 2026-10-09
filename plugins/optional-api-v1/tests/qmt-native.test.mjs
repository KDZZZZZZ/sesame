import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execute } from '../packages/qmt/worker.js';

test('authorized native Windows MiniQMT SDK imports and returns an actual quote without trading', { skip: process.env.QMT_NATIVE_TESTS !== '1', timeout: 60000 }, async t => {
  assert.equal(process.platform, 'win32', 'Native verification requires Windows; fixture success is not native verification');
  const python = process.env.QMT_PYTHON, port = Number(process.env.QMT_MARKET_PORT), symbol = process.env.QMT_TEST_SYMBOL;
  assert.ok(python); assert.ok(Number.isInteger(port) && port > 0 && port <= 65535); assert.match(symbol ?? '', /^\d{6}\.(SH|SZ|BJ)$/);
  const directory = await mkdtemp(join(tmpdir(), 'qmt-native-read-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const context = { directory, signal: AbortSignal.timeout(50000) };
  const verified = await execute({ action: 'verify', python }, context);
  assert.equal(verified.result.environment.platform, 'win32'); assert.equal(verified.result.environment.bits, 64); assert.equal(verified.process.cleanup, 'exited');
  const quotes = await execute({ action: 'quotes', python, config: { market_port: port }, symbols: [symbol] }, context);
  assert.equal(quotes.result.items[0].symbol, symbol); assert.ok(quotes.result.items[0].tick.time || quotes.result.items[0].tick.timetag); assert.equal(quotes.process.cleanup, 'exited');
});
