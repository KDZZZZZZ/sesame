import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { loadProject, saveProject } from './project.js';
import { nativePath } from './implementation.js';
import { runExperiments } from './experiments.js';
import { reservePartition } from './partition-history.js';
import { collectRefs, requireThat } from './records.js';
import { fixedTrialExperiment } from './revision-trial.js';

function protocolFor(mandate, input) {
  const terms = mandate.experiment;
  requireThat(!mandate.conflicts.length, 'Resolve the conflicting mandate terms before running backtests.');
  const objective = input.objective ?? terms.objective;
  requireThat(objective && (!terms.objective || canonical(objective) === canonical(terms.objective)),
    'Select the mandate objective, or revise the mandate before using a different objective.');
  const config = { ...terms.config, ...input.config };
  for (const [key, value] of Object.entries(terms.config)) {
    requireThat(Decimal.compare(value, config[key]) === 0, key + ' differs from the mandate. Revise the mandate or correct the experiment.');
  }
  requireThat(config.capital && config.commission && config.slippage && config.feed,
    'Choose research capital, commission, slippage and feed with their sources before running the native backend.');
  const constraints = [...new Map([...terms.constraints, ...(input.constraints ?? [])].map(item => [canonical(item), item])).values()];
  return { ...input, objective, config, constraints };
}

async function dataIdentity(host, ref) {
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  const blob = manifest.blobs?.find(item => item.path === manifest.content?.path);
  return blob?.digest ?? ref.digest;
}

export async function testProject(host, input, signal, execution) {
  const project = await loadProject(host, input.project_ref);
  let requested = input.experiment;
  if (requested.planned_trial) {
    const trial = project.parameterTrial;
    requireThat(trial && project.implementation?.nativeHash === trial.baselineNativeHash, 'Open the registered parameter trial with its original implementation.');
    requested = fixedTrialExperiment(await loadProject(host, trial.baselineRef), trial, requested.python_path);
  } else if (project.parameterTrial && !requested.selection_ref) {
    requireThat(false, 'Run the registered change using planned_trial true, or start another experiment from its baseline.');
  }
  const key = input.operation_id;
  const confirmation = Boolean(requested.selection_ref);
  const used = project.consumedHoldouts ?? [];
  let protocol = project.protocol, args = requested, holdoutDigest;
  if (requested.backend === 'backtrader') {
    requireThat(!project.mandate.conflicts.length, 'Resolve conflicting mandate terms before selecting parameters.');
    requireThat(project.implementation?.nativeSourceRef, 'Use strategy_development_build with the authored native_source_path first.');
    if (confirmation) {
      requireThat(project.experiment?.selectionRef && canonical(requested.selection_ref) === canonical(project.experiment.selectionRef),
        'Confirm the exact development selection for this project revision.');
    } else {
      if (project.implementation.nativeTemplate === 'forecast_buffer') {
        requireThat((requested.class_name ?? 'ForecastBufferStrategy') === 'ForecastBufferStrategy'
          && requested.config?.feed?.timeframe === 'days' && requested.config.feed.compression === 1,
          'The forecast_buffer template uses a single daily stock-like feed and ForecastBufferStrategy.');
        requested = { ...requested, class_name: 'ForecastBufferStrategy' };
      }
      requireThat(requested.class_name, 'Supply the class_name defined in the frozen Backtrader file.');
      requireThat(!project.structure.factorResolutions.some(item => item.status !== 'reuse'),
        'Resolve the declared factor uses before evaluating this candidate. See the project component gaps.');
      const factorRefs = new Set(collectRefs(project.structure.factors).map(ref => canonical(ref)));
      requireThat(!project.structure.gaps.some(item => item.unavailableRef && factorRefs.has(canonical(item.unavailableRef))),
        'Restore the missing factor integration evidence or revise the candidate before the native experiment.');
      protocol = protocolFor(project.mandate, requested);
      const developmentDigest = await dataIdentity(host, requested.development);
      requireThat(!used.some(item => item.digest === developmentDigest), 'This project already inspected that partition as a holdout.');
      args = { ...protocol, title: requested.title ?? project.structure.strategyId, source_digest: project.implementation.nativeHash,
        strategy_path: await nativePath(host, project.implementation.nativeSourceRef, signal) };
    }
    if (requested.holdout) {
      holdoutDigest = await dataIdentity(host, requested.holdout);
      requireThat(!used.some(item => item.digest === holdoutDigest && item.operationId !== key),
        'This project lineage has already inspected that holdout. Select a fresh confirmation interval.');
    }
  }
  const run = await runExperiments(host, { ...args, operation_id: key }, signal, { priorHoldouts: used.filter(item => !item.operationId),
    onPartition: (role, partition, selection) => reservePartition(host, project.projectKey, role, partition, selection, key) });
  const consumedHoldouts = run.holdout?.partition && holdoutDigest && !used.some(item => item.digest === holdoutDigest)
    ? [...used, { ref: requested.holdout, digest: holdoutDigest, first: run.holdout.partition.first, last: run.holdout.partition.last,
      operationId: key, selectionRef: run.selectionRef }] : used;
  const result = { ...run, validationScope: requested.backend === 'backtrader' ? (project.implementation.nativeTemplate ? 'backtrader_research_template' : 'authored_backtrader_python') : 'target_pending',
    unverifiedMandateConstraints: project.mandate.experiment.unverifiedConstraints };
  const snapshot = { ...project, experiment: result, protocol, consumedHoldouts };
  const snapshotKey = ['incomplete', 'blocked'].includes(result.status) ? key + ':progress:' + digest(result) : key;
  const output = await saveProject(host, snapshot, input.project_ref, snapshotKey);
  if (execution?.checkpoint) await execution.checkpoint({ inputDigest: digest(input), projectRef: output.projectRef });
  return output;
}
