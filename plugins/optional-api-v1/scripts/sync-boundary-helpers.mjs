import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
export const copies = [
  { source: 'scripts/shared/dataset-snapshot.js', targets: ['packages/trading-decision/dataset-snapshot.js', 'packages/judgment-evolution/dataset-snapshot.js'] },
  { source: 'scripts/shared/artifact-files.js', targets: ['packages/financial-research/artifact-files.js', 'packages/web-sources/artifact-files.js'] },
  { source: 'scripts/shared/parser.js', targets: ['packages/web-extract/parser.js', 'packages/rss-collect/parser.js', 'packages/market-data-parser/parser.js'] },
  { source: 'scripts/shared/workflow-mechanics.js', targets: ['packages/investment-research/src/workflow-mechanics.js', 'packages/trading-decision/workflow-mechanics.js', 'packages/auto-factor-mining/workflow-mechanics.js'] },
  { source: 'scripts/shared/research-artifacts.js', targets: ['packages/investment-research/src/research-artifacts.js', 'packages/trading-decision/research-artifacts.js', 'packages/auto-factor-mining/research-artifacts.js'] },
  { source: 'scripts/shared/investment-research-contract.js', targets: ['packages/investment-research/src/investment-research-contract.js', 'packages/trading-decision/investment-research-contract.js'] },
  { source: 'scripts/shared/report-publication.js', targets: ['packages/trading-decision/report-publication.js', 'packages/auto-factor-mining/report-publication.js'] },
  { source: 'scripts/shared/workflow-report-fixture.mjs', targets: ['tests/workflow-report-fixture.mjs', 'packages/auto-factor-mining/tests/workflow-report-fixture.mjs'] },
];

export function syncBoundaryHelpers(mode, base = root) {
  if (!['--check', '--write'].includes(mode)) throw new Error('Use --check or --write');
  let count = 0;
  for (const { source, targets } of copies) {
    const bytes = readFileSync(new URL(source, base));
    for (const target of targets) {
      const path = new URL(target, base);
      if (mode === '--write') writeFileSync(path, bytes);
      else if (!readFileSync(path).equals(bytes)) throw new Error(`Boundary helper copy differs: ${target}`);
      count++;
    }
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Use --check or --write');
  console.log(`${syncBoundaryHelpers(process.argv[2])} self-contained boundary helper copies ${process.argv[2] === '--write' ? 'updated' : 'verified'}`);
}
