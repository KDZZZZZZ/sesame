import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createCapabilities } from '../packages/ccxt/index.js';
import { CCXTProvider } from '../packages/ccxt/provider.js';
import { closeRecords, records } from '../packages/ccxt/records.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ccxt-connections-'));
  const root = join(directory, 'private');
  const host = {
    context: { storageRoot: root },
    capabilities: { invoke: () => assert.fail('Connection discovery must not invoke Python, network or host capabilities') },
  };
  const catalog = createCapabilities(host).find(item => item.name === 'ccxt_catalog');
  t.after(() => {
    closeRecords(host);
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return { host, root, catalog: () => catalog.execute({}) };
}

const order = items => items.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
// SQLite read-only readers can create coordination sidecars in WAL mode. They
// must preserve the database and committed WAL bytes, including uncheckpointed rows.
const bytes = root => Object.fromEntries(['public-connections.sqlite', 'public-connections.sqlite-wal'].map(name => {
  const path = join(root, name), value = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  return [name, createHash('sha256').update(value).digest('hex')];
}));

test('catalog returns no saved connections without creating private storage or a database', t => {
  const f = fixture(t);
  assert.equal(existsSync(f.root), false);
  assert.deepEqual(f.catalog().connections, []);
  assert.equal(existsSync(f.root), false);
  mkdirSync(f.root);
  assert.deepEqual(f.catalog().connections, []);
  assert.deepEqual(readdirSync(f.root), []);
});

test('catalog preserves every exchange and exact route revision while projecting only public identities', t => {
  const f = fixture(t), provider = new CCXTProvider(f.host);
  const configurations = [
    { exchange: 'kraken' },
    { exchange: 'coinbase' },
    { exchange: 'okx' },
    { exchange: 'okx', publicProxy: 'http://127.0.0.1:7897' },
    { exchange: 'okx', publicProxy: 'http://127.0.0.1:7898' },
  ];
  const expected = configurations.map((configuration, i) => ({
    exchange: configuration.exchange,
    connection: provider.bind({ configuration }, { bindingId: String(i) }).connection,
  }));
  const store = records(f.host);
  for (const row of store.list('public_connections')) store.put('public_connections', { ...row, privateMemo: 'must-stay-private' });
  store.put('unrelated', { id: 'secret', token: 'must-stay-private' });
  closeRecords(f.host);
  const before = bytes(f.root);
  const first = f.catalog(), second = f.catalog();
  assert.deepEqual(order(first.connections), order(expected));
  assert.deepEqual(second, first);
  assert.equal(first.connections.filter(item => item.exchange === 'okx').length, 3);
  assert.doesNotMatch(JSON.stringify(first), /publicProxy|127\.0\.0\.1|7897|7898|privateMemo|must-stay-private|token/);
  assert.equal(Object.hasOwn(first, 'defaultConnection'), false);
  assert.deepEqual(bytes(f.root), before, 'catalog must not change persisted business bytes');
});

test('catalog sees committed routes while the private store is open without changing its records', t => {
  const f = fixture(t), provider = new CCXTProvider(f.host);
  const connection = provider.bind({ configuration: { exchange: 'okx' } }, { bindingId: 'writer' }).connection;
  const before = records(f.host).list('public_connections');
  const persisted = bytes(f.root);
  assert.deepEqual(f.catalog().connections, [{ exchange: 'okx', connection }]);
  assert.deepEqual(records(f.host).list('public_connections'), before);
  assert.deepEqual(bytes(f.root), persisted);
});

test('discovered connection restores the original authorized proxy without configuration or a new route', t => {
  const f = fixture(t), provider = new CCXTProvider(f.host);
  const configuration = { exchange: 'okx', publicProxy: 'http://127.0.0.1:7897' };
  const selected = provider.bind({ configuration }, { bindingId: 'original' });
  closeRecords(f.host);
  const discovered = f.catalog().connections;
  assert.deepEqual(discovered, [{ exchange: 'okx', connection: selected.connection }]);
  const reopened = new CCXTProvider(f.host);
  assert.deepEqual(reopened.bind({ connection: discovered[0].connection }, { bindingId: 'restored' }), selected);
  assert.equal(reopened.bound({ bindingId: 'restored' }).proxy, configuration.publicProxy);
  assert.equal(records(f.host).list('public_connections').length, 1);
  assert.throws(() => reopened.bind({ connection: { ...discovered[0].connection, revision: 'guessed' } }, { bindingId: 'wrong' }), { code: 'CONNECTION_CHANGED' });
});
