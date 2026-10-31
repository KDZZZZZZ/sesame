import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../report.js';

const fixture = JSON.parse(await readFile(new URL('../examples/demo-run.json', import.meta.url), 'utf8'));
const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../examples/report.demo.html', import.meta.url));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, renderReport(fixture, { demo: true }), 'utf8');
console.log(output);
