import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { parseRows } from '../packages/web-sources/data.js';
import { createCapabilities as sourceCapabilities } from '../packages/web-sources/index.js';
import { publishRows, readEntry } from '../packages/web-sources/resource-files.js';
import { hostRoot, nativeHost } from './host-v2-fixture.mjs';

test('public JSON objects retain an exact row instead of failing array-only normalization', () => {
  assert.deepEqual(parseRows('{"base_code":"USD","rates":{"EUR":0.9}}'), [{ base_code: 'USD', rates: { EUR: 0.9 } }]);
  assert.throws(() => parseRows('42'), /对象/);
});

test('native parser transport consumes frozen sources without copying them through Agent input', { skip: !hostRoot, timeout: 60000 }, async t => {
  const f = await nativeHost(t), sourceHost = f.attach('web-sources', sourceCapabilities);
  for (const name of ['web-extract', 'rss-collect', 'market-data-parser']) {
    const { createCapabilities } = await import(`../packages/${name}/index.js`);
    f.attach(name, createCapabilities);
  }
  const html = `<html><title>Frozen HTML</title><body><script>${'x'.repeat(1200 * 1024)}</script><p>Complete body after a large script.</p></body></html>`;
  const unicode = '<html><body><p>' + 'a'.repeat(256 * 1024 - Buffer.byteLength('<html><body><p>') - 1) + '金价😀' + '</p></body></html>';
  const fixtures = {
    '/page': ['text/html', html],
    '/rss': ['application/xml', '<rss version="2.0"><channel><title>Official news</title><item><title>Decision</title><link>https://example.org/decision</link><pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'],
    '/rates': ['application/json', '{"result":"success","provider":"https://www.exchangerate-api.com","base_code":"USD","time_last_update_utc":"Sun, 18 Oct 2026 00:00:00 +0000","rates":{"USD":1,"EUR":0.9}}'],
    '/unicode': ['text/html; charset=utf-8', unicode],
    '/latin': ['text/html; charset=iso-8859-1', Buffer.from('<html><body><p>caf\xe9</p><a href="/article">suite</a><nav><a href="/menu">menu</a></nav></body></html>', 'latin1')],
  };
  const requests = [];
  const server = createServer((req, res) => { requests.push(req.url); const [type, text] = fixtures[req.url]; res.writeHead(200, { 'content-type': type }); res.end(text); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const fetch = path => invokeValue(sourceHost, 'sesame/web-sources#sources_fetch', { url: `http://127.0.0.1:${server.address().port}${path}` });
  const page = await fetch('/page');
  assert.equal(page.text.length, 20000);
  assert.ok(!page.text.includes('Complete body'));
  const extracted = await f.call('sesame/web-extract#extract_webpage', { source_ref: page.ref });
  assert.equal(extracted.text, 'Complete body after a large script.');
  assert.deepEqual(extracted.source_ref, page.ref);
  assert.equal(extracted.source_provenance.provider, page.provenance.provider);
  assert.equal(extracted.source_provenance.as_of, page.provenance.as_of);
  const feed = await fetch('/rss');
  const parsed = await f.call('sesame/rss-collect#parse_feed', { source_ref: feed.ref, max_entries: 1 });
  assert.equal(parsed.entries[0].title, 'Decision');
  const rates = await fetch('/rates');
  const currencies = await f.call('sesame/market-data-parser#parse_fx_json', { source_ref: rates.ref, codes: ['eur'] });
  assert.deepEqual(currencies.rates, { EUR: 0.9 });
  assert.equal(currencies.base, 'USD');
  assert.equal(currencies.date, 'Sun, 18 Oct 2026 00:00:00 +0000');
  assert.deepEqual(requests, ['/page', '/rss', '/rates'], 'parsing never re-fetches a source');
  const utf = await fetch('/unicode');
  const unicodeResult = await f.call('sesame/web-extract#extract_webpage', { source_ref: utf.ref });
  const unicodeText = (await readEntry(sourceHost, unicodeResult.result_ref, unicodeResult.result_entries.text)).toString('utf8');
  assert.ok(unicodeText.endsWith('金价😀'));
  const latin = await fetch('/latin'), decoded = await f.call('sesame/web-extract#extract_webpage', { source_ref: latin.ref });
  assert.equal(decoded.text, 'café suite');
  assert.deepEqual(decoded.links, [`http://127.0.0.1:${server.address().port}/article`]);
  assert.equal(latin.provenance.data_hash, 'sha256:' + createHash('sha256').update(fixtures['/latin'][1]).digest('hex'));
  const rawLatin = await sourceHost.resources.read(latin.ref, { part: 'content', entry: 'source.txt', encoding: 'base64' });
  assert.deepEqual(Buffer.from(rawLatin.content, 'base64'), fixtures['/latin'][1]);
  const old = await publishRows(sourceHost, { title: 'Old snapshot', rows: [{ url: 'https://example.org/old', text: '<p>Retained source</p>' }], provenance: { kind: 'observed', provider: 'https://example.org/old', as_of: '2026-10-18T10:00:00Z' } });
  assert.equal((await f.call('sesame/web-extract#extract_webpage', { source_ref: old })).text, 'Retained source');
  await assert.rejects(f.call('sesame/web-extract#extract_webpage', { source_ref: page.ref, html_content: '<p>Ambiguous</p>' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.call('sesame/web-extract#extract_webpage', { file_path: '../plugin.json' }), /relative|package|escape/);
  await assert.rejects(f.call('sesame/rss-collect#parse_feed', { xml_content: '<broken>' }), /XML parse error/);
});

test('parser packages declare the native boundary, exact inputs and required host capability', { skip: !hostRoot }, async () => {
  const { inspectPackage } = await import(pathToFileURL(`${hostRoot}/modules/agent/plugin-system/package.js`));
  const { readdir } = await import('node:fs/promises');
  for (const name of ['web-sources', 'web-extract', 'rss-collect', 'market-data-parser']) {
    const root = new URL(`../packages/${name}/`, import.meta.url), files = {};
    for (const path of await readdir(root, { recursive: true })) {
      try { files[path.replaceAll('\\', '/')] = await readFile(new URL(path.replaceAll('\\', '/'), root)); }
      catch (error) { if (error.code !== 'EISDIR') throw error; }
    }
    const packageInfo = inspectPackage(files);
    assert.equal(packageInfo.execution, 'native');
    if (name === 'web-sources') continue;
    assert.ok(packageInfo.capabilityManifest.capabilities.every(cap => cap.requires.some(requirement => requirement.capability === 'host.process.exec')));
    assert.ok(packageInfo.capabilityManifest.capabilities.every(cap => cap.inputSchema.oneOf.length === 3));
  }
});

test('a 2 MiB plain-text page returns a bounded preview and a complete readable result artifact', { skip: !hostRoot, timeout: 60000 }, async t => {
  const f = await nativeHost(t), sourceHost = f.attach('web-sources', sourceCapabilities);
  const { createCapabilities } = await import('../packages/web-extract/index.js');
  f.attach('web-extract', createCapabilities);
  const prefix = '<html><body><p>', suffix = ' END_OF_COMPLETE_ARTICLE</p></body></html>';
  const body = 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix + suffix));
  const html = prefix + body + suffix;
  assert.equal(Buffer.byteLength(html), 2 * 1024 * 1024);
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const fetched = await invokeValue(sourceHost, 'sesame/web-sources#sources_fetch', { url: `http://127.0.0.1:${server.address().port}/article` });
  const parsed = await f.call('sesame/web-extract#extract_webpage', { source_ref: fetched.ref });
  assert.ok(Buffer.byteLength(JSON.stringify(parsed, null, 2)) < 24 * 1024, 'the Agent receives an explicitly bounded result, not a multi-megabyte tool response');
  assert.equal(parsed.output_truncated, true);
  assert.equal(parsed.text, undefined, 'a preview must not masquerade as complete text');
  assert.equal(parsed.text_length, body.length + ' END_OF_COMPLETE_ARTICLE'.length);
  assert.deepEqual(parsed.source_ref, fetched.ref);
  const manifest = await sourceHost.resources.read(parsed.result_ref, { part: 'manifest' });
  assert.equal(manifest.content.provenance.kind, 'derived');
  assert.deepEqual(manifest.dependencies, [fetched.ref]);
  const fullText = (await readEntry(sourceHost, parsed.result_ref, parsed.result_entries.text)).toString('utf8');
  assert.equal(fullText, body + ' END_OF_COMPLETE_ARTICLE');
  const rows = JSON.parse((await readEntry(sourceHost, parsed.result_ref, parsed.result_entries.structured)).toString('utf8'));
  assert.equal(rows[0].text, fullText);
  assert.deepEqual(rows[0].source_provenance, fetched.provenance);
  const { toolResult } = await import(pathToFileURL(`${hostRoot}/modules/agent/tools.js`));
  assert.equal(JSON.parse(toolResult(parsed).content[0].text)._tool_output_truncated, undefined, 'no generic tool-output clipping or workspace JSON fallback is needed');
});

test('visible HTML excludes explicitly hidden metadata without suppressing following content', { skip: !hostRoot }, async t => {
  const f = await nativeHost(t);
  const { createCapabilities } = await import('../packages/web-extract/index.js');
  f.attach('web-extract', createCapabilities);
  const parsed = await f.call('sesame/web-extract#extract_webpage', { html_content: '<html><head><title>Visible company</title></head><body><div style="DISPLAY: none !important"><span>HIDDEN_STYLE</span><br><a href="https://example.org/hidden">hidden link</a></div><section hidden><p>HIDDEN_ATTRIBUTE</p></section><ix:hidden><span>XBRL_PRIVATE_HEADER</span></ix:hidden><span style="color:red; visibility : hidden;">HIDDEN_VISIBILITY</span><img hidden src="x"><p>Visible revenue</p><div><span>Visible cash flow</span></div><a href="https://example.org/visible">Visible source</a></body></html>' });
  assert.equal(parsed.title, 'Visible company');
  assert.equal(parsed.text, 'Visible revenue Visible cash flow Visible source');
  assert.deepEqual(parsed.links, ['https://example.org/visible']);
});

test('long feed and currency outputs expose only resource entries that actually exist', { skip: !hostRoot, timeout: 60000 }, async t => {
  const f = await nativeHost(t);
  for (const name of ['rss-collect', 'market-data-parser']) {
    const { createCapabilities } = await import(`../packages/${name}/index.js`);
    const host = f.attach(name, createCapabilities);
    const input = name === 'rss-collect'
      ? { xml_content: `<rss version="2.0"><channel><title>${'Feed title '.repeat(3000)}</title><item><title>Decision</title></item></channel></rss>` }
      : { json_content: JSON.stringify({ base: 'USD', rates: Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`TEST${index}`, index + 1])) }) };
    const localId = name === 'rss-collect' ? 'parse_feed' : 'parse_fx_json';
    const value = await f.call(`sesame/${name}#${localId}`, input);
    assert.equal(value.output_truncated, true);
    assert.deepEqual(value.result_entries, { structured: 'rows.json' });
    const rows = JSON.parse((await readEntry(host, value.result_ref, value.result_entries.structured)).toString('utf8'));
    assert.equal(rows.length, 1);
    if (name === 'rss-collect') assert.equal(rows[0].entries[0].title, 'Decision');
    else assert.equal(Object.keys(rows[0].rates).length, 3000);
    const declaration = JSON.parse(await readFile(new URL(`../packages/${name}/capabilities.json`, import.meta.url)));
    for (const cap of declaration.capabilities) {
      assert.ok(cap.usage.outputs.includes('entry:result_entries.structured'));
      assert.ok(!cap.usage.outputs.includes('entry:"text.txt"'));
    }
    const skill = await readFile(new URL(`../packages/${name}/skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.ok(skill.includes('entry:result_entries.structured'));
    assert.ok(!skill.includes('entry:"text.txt"'));
  }
});

test('bundled parser examples retain their numerical and extraction outputs', { skip: !hostRoot, timeout: 60000 }, async t => {
  const f = await nativeHost(t);
  for (const name of ['web-extract', 'rss-collect', 'market-data-parser']) {
    const { createCapabilities } = await import(`../packages/${name}/index.js`);
    f.attach(name, createCapabilities);
    const samples = JSON.parse(await readFile(new URL(`../packages/${name}/samples.json`, import.meta.url)));
    for (const sample of samples) assert.deepEqual(await f.call(`sesame/${name}#${sample.tool}`, sample.arguments), sample.expected);
  }
});
