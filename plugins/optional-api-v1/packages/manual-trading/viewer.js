import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest } from '@sesame/plugin-sdk/protocol';
import { check } from './adapters.js';
import { activitySnapshot } from './activity.js';
import { ensureReportFolder, reportPath } from './reports.js';
import { TERMINAL, cleanError } from './plans.js';

const assets = Object.fromEntries(['html', 'css', 'js'].map(extension => [extension,
  readFileSync(new URL(`./assets/collaboration.${extension}`, import.meta.url), 'utf8')]));
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function activityHTML(snapshot) {
  const values = { CSS: assets.css, INITIAL: safeJSON(snapshot), SCRIPT: assets.js };
  return assets.html.replace(/__SESAME_ACTIVITY_(CSS|INITIAL|SCRIPT)__/g, (_match, key) => values[key]);
}

/** A read-only, capability-scoped viewer. Opening a page never starts a run. */
export class TradingActivityViewer {
  constructor(runtime) {
    this.runtime = runtime;
    this.entries = new Map();
    this.byRun = new Map();
    this.clients = new Set();
    this.archiving = new Map();
    this.closed = false;
    this.unsubscribe = runtime.onActivity(notice => {
      for (const client of this.clients) if (client.runId === notice.runId) this.schedule(client);
      const entry = this.byRun.get(notice.runId);
      if (entry && notice.events.some(event => event.type === 'run.finished')) {
        this.archive(entry.host, notice.runId).catch(error => {
          this.runtime.host.events?.emit('activity.archive.failed', { runId: notice.runId, ...cleanError(error) });
        });
      }
    });
  }

  authorize(host, runId) {
    this.runtime.main(host);
    return this.runtime.authorize(host, runId);
  }

  read(host, runId) { return activitySnapshot(this.authorize(host, runId), { mode: 'live' }); }

  async listen() {
    check(!this.closed, 'RUNTIME_CLOSED', 'Activity viewer is closed');
    if (!this.listening) this.listening = new Promise((resolve, reject) => {
      this.server = createServer((request, response) => {
        try { this.serve(request, response); }
        catch { if (!response.headersSent) response.writeHead(500); response.end('Activity unavailable'); }
      });
      this.server.maxConnections = 32;
      this.server.headersTimeout = 10000;
      this.server.on('clientError', (_error, socket) => socket.destroy());
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.origin = `http://127.0.0.1:${this.server.address().port}`;
        this.server.unref();
        resolve();
      });
    }).catch(error => { this.listening = null; throw error; });
    await this.listening;
    check(!this.closed, 'RUNTIME_CLOSED', 'Activity viewer is closed');
  }

  async open(host, runId) {
    this.authorize(host, runId);
    await this.listen();
    let entry = this.byRun.get(runId);
    if (!entry) {
      entry = { token: randomBytes(32).toString('hex'), runId, host };
      this.entries.set(entry.token, entry);
      this.byRun.set(runId, entry);
    }
    return { runId, mode: 'live', url: `${this.origin}/${entry.token}/`,
      archiveUrl: `${this.origin}/${entry.token}/archive.html`,
      localOnly: true, expires: 'plugin-runtime-lifetime' };
  }

  snapshot(entry, mode = 'live') {
    return activitySnapshot(this.runtime.run(entry.runId), {
      mode, ...(mode === 'live' ? { feedUrl: `/${entry.token}/events` } : {}),
    });
  }

  serve(request, response) {
    const reject = status => { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end(); };
    if (this.closed || request.method !== 'GET') return reject(405);
    if (request.headers.host !== new URL(this.origin).host || request.headers.origin && request.headers.origin !== this.origin) return reject(403);
    const match = /^\/([a-f0-9]{64})\/(|events|snapshot\.json|archive\.html)$/.exec(request.url);
    const entry = match && this.entries.get(match[1]);
    if (!entry) return reject(404);
    const headers = {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    };
    if (match[2] === 'events') {
      if (this.clients.size >= 24) return reject(503);
      response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      response.write('retry: 1000\n\n');
      const client = { response, runId: entry.runId, entry, pending: null, heartbeat: null };
      this.clients.add(client);
      this.send(client);
      client.heartbeat = setInterval(() => {
        if (response.writableLength > 2 * 1024 * 1024) response.destroy();
        else response.write(': keepalive\n\n');
      }, 15000);
      client.heartbeat.unref();
      response.on('close', () => {
        clearTimeout(client.pending); clearInterval(client.heartbeat); this.clients.delete(client);
      });
      return;
    }
    const snapshot = this.snapshot(entry, match[2] === 'archive.html' ? 'archive' : 'live');
    if (match[2] === 'snapshot.json') {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(snapshot));
    } else {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      response.end(activityHTML(snapshot));
    }
  }

  schedule(client) {
    if (client.pending || this.closed) return;
    client.pending = setTimeout(() => { client.pending = null; this.send(client); }, 40);
    client.pending.unref();
  }

  send(client) {
    if (client.response.destroyed || this.closed) return;
    if (client.response.writableLength > 2 * 1024 * 1024) { client.response.destroy(); return; }
    try {
      const snapshot = this.snapshot(client.entry);
      client.response.write(`id: ${snapshot.events.at(-1)?.seq ?? 0}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch { client.response.end(); }
  }

  async archive(host, runId) {
    const run = this.authorize(host, runId);
    check(TERMINAL.has(run.status) && run.tasks.every(task => !['queued', 'running'].includes(task.status)),
      'RUN_NOT_FINISHED', 'Wait for the actual tasks and reporter to finish before archiving collaboration');
    if (!this.archiving.has(runId)) this.archiving.set(runId, this.writeArchive(host, run).finally(() => this.archiving.delete(runId)));
    return this.archiving.get(runId);
  }

  async writeArchive(host, run) {
    const { files, prefix } = await ensureReportFolder(host, run.plan.reportFolder);
    const existing = await files.list({ recursive: true });
    if (run.activityReport?.fileId) {
      const file = existing.entries.find(entry => entry.id === run.activityReport.fileId);
      return { ...run.activityReport, path: file?.path ?? run.activityReport.path, state: file ? 'archived' : 'removed_by_user' };
    }
    const path = `${prefix}${reportPath(run).replace(/\.html$/, '.collaboration.html')}`;
    const snapshot = activitySnapshot(run, { mode: 'archive' });
    const html = activityHTML(snapshot), dataPath = path.replace(/\.html$/, '.json');
    let htmlEntry;
    for (const [target, content] of [[dataPath, JSON.stringify(snapshot, null, 2)], [path, html]]) {
      let entry = existing.entries.find(value => value.path === target);
      if (entry) check((await files.read({ path: target })).content === content, 'REPORT_PATH_OCCUPIED', 'Existing collaboration recording differs; it will not be overwritten');
      else entry = await files.write({ path: target, content });
      if (target === path) htmlEntry = entry;
    }
    const report = { fileId: htmlEntry.id, path, dataPath, space: 'research', digest: digest(html), state: 'archived' };
    this.runtime.update(run.id, { activityReport: report });
    return report;
  }

  async dispose() {
    this.closed = true;
    this.unsubscribe();
    for (const client of this.clients) {
      clearTimeout(client.pending); clearInterval(client.heartbeat); client.response.end();
    }
    this.clients.clear(); this.entries.clear(); this.byRun.clear();
    // Let an in-flight listen settle before closing it; closing earlier can leave
    // Node's listening promise unresolved forever during plugin deactivation.
    await Promise.allSettled([this.listening, ...this.archiving.values()]);
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
  }
}
