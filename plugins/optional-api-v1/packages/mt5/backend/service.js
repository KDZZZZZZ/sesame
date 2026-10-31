import { records } from './records.js';
import { SDK_VERSION } from './contracts.js';
import * as projects from './projects.js';
import * as compiler from './compiler.js';
import { MT5Official } from './official.js';
import { Tester } from './tester.js';
import { Market } from './market.js';
import { LiveMarket } from './live.js';
import { Deployments } from './deployments.js';

// One lifecycle and state owner; domain modules operate on this same instance.
export class MT5 {
  constructor(host, options = {}) { this.host = host; this.storage = records(host); this.options = options; this.jobs = new Map(); this.tail = Promise.resolve(); }
  async init() {
    await projects.init(this);
    compiler.discover(this);
    this.official = await new MT5Official(this.host, this.native).init();
    this.market = new Market(this);
    this.live = new LiveMarket(this);
    this.deployments = new Deployments(this);
    this.tester = new Tester(this).init();
    compiler.recover(this);
    return this;
  }
  status() {
    const compile = Boolean(this.compilerReady);
    return { installed: Boolean(this.native), compile, tester: Boolean(this.tester?.available()), deploy: Boolean(this.native), sdk_version: SDK_VERSION,
      reason: compile ? '已发现编译入口；Tester、账户连接和交易权限须分别核验。' : '可编辑独立工程；运行 mt5_dependencies inspect 先复用已有安装，再按缺项安装与配置。',
      dependencies: { tool: 'mt5_dependencies', action: 'inspect', probe: true } };
  }
  list() { return projects.list(this); }
  project(key) { return projects.project(this, key); }
  create(title) { return projects.create(this, title); }
  configure(key, limits, expectedVersion) { return projects.configure(this, key, limits, expectedVersion); }
  validateSource(project, source) { return projects.validateSource(this, project, source); }
  async checkout(host, key, signal, conversationId) { return projects.checkout(this, host, key, signal, conversationId); }
  async save(host, checkoutId, signal, conversationId) { return projects.save(this, host, checkoutId, signal, conversationId); }
  queueBuild(key, revision, conversationId = null, host = this.host) { return compiler.queueBuild(this, key, revision, conversationId, host); }
  startBuild(buildId, signal) { return compiler.startBuild(this, buildId, signal); }
  async compile(build, signal) { return compiler.compile(this, build, signal); }
  async close() {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    // Stop subscribers, then abort their I/O before awaiting any feed jobs.
    const live = this.live.close(), market = this.market.close(), official = this.official.close();
    await Promise.allSettled([live, market, official, this.tester.close(), this.deployments.close(), ...[...this.jobs.values()].map(job => job.promise)]);
  }
}
