import { readFileSync } from 'node:fs';

// Kept byte-identical in both independent plugin packages; checked by tests.
const assets = Object.fromEntries(['html', 'css', 'js'].map(extension => [extension,
  readFileSync(new URL(`./assets/collaboration.${extension}`, import.meta.url), 'utf8')]));
const helpers = ['canvas', 'icons', 'markdown'].map(name =>
  readFileSync(new URL(`./assets/collaboration-${name}.js`, import.meta.url), 'utf8')).join('\n');
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };

export function activityHTML(snapshot) {
  const values = { CSS: assets.css, INITIAL: safeJSON(snapshot), SCRIPT: `${helpers}\n${assets.js}` };
  return assets.html.replace(/__SESAME_ACTIVITY_(CSS|INITIAL|SCRIPT)__/g, (_match, key) => values[key]);
}

/** A transient HTML view in Sesame's report panel. No per-role files or browser server. */
export class LiveActivityViewer {
  constructor(runtime, projection) {
    this.runtime = runtime; this.projection = projection; this.closed = false;
    this.views = new Set(); this.opening = new Set();
  }
  read(host, runId) { return this.projection.read(host, runId); }
  async open(host, runId) {
    check(!this.closed, 'RUNTIME_CLOSED', 'Activity viewer is closed');
    const initial = this.read(host, runId);
    check(host.reports?.live?.open && this.runtime.host.reports?.live?.close,
      'HOST_UPGRADE_REQUIRED', 'Update Sesame to a version with live HTML report panels');
    let viewId, subscribed = false;
    const opening = Promise.resolve().then(() => host.reports.live.open({
      key: runId, title: initial.run.title, html: activityHTML(initial),
    }, {
      // These callbacks use only the durable plugin service, never a retained tool host.
      read: () => this.projection.snapshot(runId),
      subscribe: callback => {
        const unsubscribe = this.runtime.onActivity(notice => { if (notice.runId === runId) callback(); });
        subscribed = true;
        return () => { subscribed = false; this.views.delete(viewId); unsubscribe(); };
      },
    })).then(async view => {
      viewId = view.viewId;
      if (this.closed) {
        await this.runtime.host.reports.live.close(view.viewId);
        check(false, 'RUNTIME_CLOSED', 'Activity viewer is closed');
      }
      // Reused views already have an owning subscription; evicted views have none.
      if (subscribed) this.views.add(viewId);
      return { ...view, runId };
    });
    this.opening.add(opening);
    try { return await opening; } finally { this.opening.delete(opening); }
  }
  async dispose() {
    this.closed = true;
    await Promise.allSettled(this.opening);
    await Promise.allSettled([...this.views].map(viewId => this.runtime.host.reports.live.close(viewId)));
    this.views.clear();
  }
}
