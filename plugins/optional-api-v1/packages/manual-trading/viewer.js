import { LiveActivityViewer } from './live-viewer.js';
import { activitySnapshot } from './activity.js';
import { check } from './shared.js';
import { TERMINAL } from './plans.js';
export { activityHTML } from './live-viewer.js';

export class TradingActivityViewer extends LiveActivityViewer {
  constructor(runtime) {
    super(runtime, {
      read(host, runId) { runtime.main(host); return activitySnapshot(runtime.authorize(host, runId)); },
      snapshot(runId, feedUrl) { return activitySnapshot(runtime.run(runId), { feedUrl }); },
    });
  }

  // Older callers receive the same final summary, never a second collaboration file.
  async archive(host, runId) {
    this.read(host, runId);
    const run = this.runtime.run(runId);
    check(TERMINAL.has(run.status) && run.tasks.every(task => !['queued', 'running'].includes(task.status)),
      'RUN_NOT_FINISHED', 'Wait for all tasks before requesting the final summary');
    return this.runtime.archive(host, runId);
  }
}
