import { LiveActivityViewer } from './live-viewer.js';
import { activitySnapshot } from './activity.js';

export class MiningActivityViewer extends LiveActivityViewer {
  constructor(runtime) {
    super(runtime, {
      read(host, runId) { const run = runtime.get(runId); runtime.main(host, run); return activitySnapshot(run); },
      snapshot(runId, feedUrl) { return activitySnapshot(runtime.get(runId), { feedUrl }); },
    });
  }
}
