import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(readFileSync(new URL('./methods/index.json', import.meta.url), 'utf8'));
const entries = new Map(catalog.entries.map(entry => [entry.id, entry]));
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}.-]+/gu, ' ').trim();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const metadata = entry => structuredClone(Object.fromEntries(
  ['id', 'kind', 'title', 'summary', 'questions', 'path', 'related', 'references'].filter(key => entry[key] !== undefined).map(key => [key, entry[key]])
));

function argumentsFor(args, keys) {
  assert(object(args), 'Arguments must be an object');
  assert(Object.keys(args).every(key => keys.includes(key)), 'Use only the declared research arguments');
}

function relevance(entry, query) {
  if (normalize(entry.id) === query) return 1000;
  const phrases = [entry.title, ...(entry.keywords ?? []), ...(entry.questions ?? [])].map(normalize);
  return phrases.reduce((score, phrase) => {
    if (!phrase) return score;
    if (query === phrase) return score + 100;
    if (query.includes(phrase)) return score + Math.min(40, phrase.length * 2);
    if (phrase.includes(query) && query.length >= 2) return score + Math.min(20, query.length);
    return score;
  }, 0);
}

export function researchMethods(args = {}) {
  argumentsFor(args, ['query', 'limit']);
  assert(args.query === undefined || typeof args.query === 'string' && args.query.length <= 1000, 'query must be a string of at most 1000 characters');
  const limit = args.limit ?? 8;
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'limit must be an integer from 1 to 50');
  const query = normalize(args.query ?? '');
  const candidates = catalog.entries
    .map((entry, order) => ({ entry, order, score: query ? relevance(entry, query) : entry.kind === 'method' ? 1 : 0 }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return {
    items: candidates.slice(0, limit).map(item => metadata(item.entry)),
    total: candidates.length,
    hasMore: candidates.length > limit,
    guidance: query && !candidates.length
      ? '没有名称匹配不代表没有适用方法。改用问题性质或关键关系查询，或不传 query 查看目录；读取 adapt-and-compose 为本次问题设计调查。'
      : '候选是可裁剪的调查起点。按本次问题选择主线，按需读取相关方法及资料，不拼接全部结构。',
    resources: catalog.common.map(id => metadata(entries.get(id))),
  };
}

export async function researchRead(args, signal) {
  argumentsFor(args, ['ids']);
  assert(Array.isArray(args.ids) && args.ids.length >= 1 && args.ids.length <= 5, 'ids must contain 1 to 5 research IDs');
  assert(args.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100), 'Each research ID must be a nonempty string');
  assert(new Set(args.ids).size === args.ids.length, 'Use each research ID only once per batch');
  const selected = args.ids.map(id => {
    const entry = entries.get(id);
    assert(entry, `Unknown research ID: ${id}. Use research_methods to discover IDs.`);
    return entry;
  });
  signal?.throwIfAborted();
  const items = await Promise.all(selected.map(async entry => ({
    ...metadata(entry),
    content: await readFile(new URL(entry.path, import.meta.url), { encoding: 'utf8', ...(signal ? { signal } : {}) }),
  })));
  return { items };
}

export function createCapabilities() {
  return [
    { name: 'research_methods', execute: args => researchMethods(args) },
    { name: 'research_read', execute: (args, signal) => researchRead(args, signal) },
  ];
}
