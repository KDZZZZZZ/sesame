import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageDirectories } from '../../api-v1/scripts/plugin-lock.mjs';
import { readWorkflowDefinitions, validateWorkflowSet } from '../workflow/definition.mjs';
import { readCase, packageSnapshot, runCase } from './replay.mjs';
import { sandboxCall } from './sandbox.mjs';

// Trusted-base CI can validate sandbox case structure and its replayable
// assertions without running the candidate. Local check also runs its sandbox calls.
export function verifyCases(repository, { staticOnly = false } = {}) {
  const summary = { packages: 0, cases: 0, assertions: 0, sandboxCallsDeferred: 0 };
  const workflows = [];
  for (const profile of ['api-v1', 'optional-api-v1']) {
    const source = join(repository, 'plugins', profile);
    for (const name of packageDirectories(source)) {
      const dir = join(source, 'packages', name), pkg = packageSnapshot(dir);
      workflows.push(...readWorkflowDefinitions(pkg.files, pkg.manifest.id).map(item => item.definition));
      const cases = Object.keys(pkg.files).filter(path => /^evals\/cases\/[^/]+\.yaml$/.test(path));
      if (!cases.length) throw new Error('Missing an evaluation case for ' + pkg.manifest.id);
      for (const file of cases) {
        try {
          const test = readCase(join(dir, file));
          const deferred = new Set();
          const runner = staticOnly ? (_pkg, params) => {
            if (!pkg.tools.some(tool => tool.name === params.name)) throw new Error('Unknown sandbox tool: ' + params.name);
            summary.sandboxCallsDeferred++;
            return {};
          } : sandboxCall;
          if (staticOnly && test.doc.environment.mode === 'sandbox') {
            test.doc.steps.forEach((step, index) => { if (step.operation === 'tools/call') deferred.add(index); });
          }
          const report = runCase(pkg, test, runner);
          const checks = report.checks.filter(({ step }) => !deferred.has(step));
          if (checks.some(check => !check.pass)) throw new Error(JSON.stringify(checks.filter(check => !check.pass)));
          summary.assertions += checks.length;
          summary.cases++;
        } catch (error) {
          throw new Error(pkg.manifest.id + '/' + file + ': ' + error.message, { cause: error });
        }
      }
      summary.packages++;
    }
  }
  const cycle = validateWorkflowSet(workflows);
  if (cycle) throw new Error('Workflow fallback cycle: ' + cycle.join(' → '));
  return summary;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), staticOnly = args[0] === '--static';
    if (args.length && (!staticOnly || args.length !== 2)) throw new Error('Use verify-cases.mjs [--static <repository>]');
    const root = staticOnly ? resolve(args[1]) : fileURLToPath(new URL('../../../', import.meta.url));
    console.log(JSON.stringify(verifyCases(root, { staticOnly })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
