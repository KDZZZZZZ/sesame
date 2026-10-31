import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchPage, searchRequest, searchWeb } from '../packages/web-sources/search.js';

const result = (url, title = 'Decision', snippet = 'Official statement') => `<tr><td><a class='result-link' href='${url}'>${title}</a></td></tr><tr><td class='result-snippet'>${snippet}</td></tr>`;
const wrapped = url => `//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=ignored`;

test('search request encodes public query, site and declared date filter without supplying authentication', () => {
  const actual = searchRequest({ query: ' inflation & rates ', site: 'FederalReserve.gov', time_range: 'month', limit: 5 });
  const url = new URL(actual.url);
  assert.equal(url.origin, 'https://lite.duckduckgo.com');
  assert.equal(url.searchParams.get('q'), 'site:federalreserve.gov inflation & rates');
  assert.equal(url.searchParams.get('df'), 'm');
  assert.equal(actual.limit, 5);
  for (const input of [{query:' '},{query:'x',site:'https://example.org'},{query:'x',site:'example.org@evil.org'},{query:'x',site:'a..org'},{query:'x',limit:0},{query:'x',time_range:'yesterday'}]) {
    assert.throws(() => searchRequest(input), { code: 'invalid_request' });
  }
});

test('search decoding preserves a candidate and never fabricates its publication time', () => {
  const page = result(wrapped('https://example.org/news?a=1&b=2'), 'A &amp; B &#x1f4c8;', 'Rates <b>changed</b> &lt;condition&gt;');
  const parsed = parseSearchPage(page);
  assert.deepEqual(parsed.results[0], {rank:1,title:'A & B 📈',url:'https://example.org/news?a=1&b=2',snippet:'Rates changed <condition>',published_at:null});
  assert.equal(parsed.coverage.publication_times_verified, false);
});

test('site results are actually filtered; duplicates, credentials, executable URLs and provider navigation are excluded', () => {
  const page = [result(wrapped('https://example.org/yes#part')),result('https://example.org/yes#other'),result('https://sub.example.org/yes'),
    result('https://example.org.evil.org/no'),result('https://notexample.org/no'),result('https://user:password@example.org/no'),
    result('javascript:alert(1)'),result('https://duckduckgo.com/l/?bad=1')].join('');
  const parsed = parseSearchPage(page, {site:'example.org',limit:1});
  assert.deepEqual(parsed.results.map(r=>r.url), ['https://example.org/yes']);
  assert.equal(parsed.coverage.candidate_count, 8);
  assert.equal(parsed.coverage.eligible_count, 2);
  assert.equal(parsed.coverage.excluded_count, 6);
  assert.equal(parsed.coverage.has_more, true);
});

test('challenge and unknown page structure cannot be reported as zero search results', () => {
  assert.equal(parseSearchPage('<form id="challenge-form" action="/anomaly.js">verify</form>').error.code, 'search_challenge');
  assert.equal(parseSearchPage('<html><h1>Maintenance</h1></html>').error.code, 'search_format_error');
  assert.deepEqual(parseSearchPage('<div class="no-results">No results found</div>').results, []);
});

test('search transport retains full raw bytes and candidate-only provenance with no automatic retry', async () => {
  const html = result(wrapped('https://example.org/story')) + '<form class="next_form"></form>';
  let calls = 0;
  const value = await searchWeb({query:'public topic'}, undefined, async url => {
    calls++;
    return {status:'available',url,bytes:Buffer.from(html),text:html,content_type:'text/html',encoding:'utf-8'};
  });
  assert.equal(calls, 1);
  assert.equal(value.rows[0].evidence_kind, 'search_result');
  assert.equal(value.rows[0].retrieved_at, value.provenance.as_of);
  assert.equal(value.rows[0].published_at, null);
  assert.ok(value.source.bytes.equals(Buffer.from(html)));
  assert.equal(value.coverage.has_more, true);
  const failure={status:'unavailable',url:'https://lite.duckduckgo.com/lite/',error:{code:'source_http_error',http_status:429,message:'limited'}};
  assert.equal(await searchWeb({query:'public topic'}, undefined, async () => {calls++;return failure;}), failure);
  assert.equal(calls, 2);
});

test('unexpected redirect and in-band challenge preserve explicit unavailability', async () => {
  for (const [url,text,code] of [['https://other.example/login','<p>Login</p>','search_format_error'],
    ['https://lite.duckduckgo.com/lite/','<div class="anomaly-modal">Captcha</div>','search_challenge']]) {
    const actual=await searchWeb({query:'public topic'},undefined,async()=>({status:'available',url,text,bytes:Buffer.from(text),content_type:'text/html',encoding:'utf-8'}));
    assert.equal(actual.status,'unavailable');assert.equal(actual.error.code,code);assert.equal(actual.ref,undefined);assert.equal(actual.results,undefined);
  }
});
