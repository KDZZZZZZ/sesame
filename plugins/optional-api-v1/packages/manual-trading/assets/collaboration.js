(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const roles = [
    { id: 'market', name: '市场分析', icon: '市' }, { id: 'fundamentals', name: '基本面', icon: '基' },
    { id: 'news', name: '新闻分析', icon: '闻' }, { id: 'sentiment', name: '情绪分析', icon: '情' },
    { id: 'bull', name: '多头研究', icon: '多' }, { id: 'bear', name: '空头研究', icon: '空' },
    { id: 'risk', name: '风险审查', icon: '险' }, { id: 'manager', name: '投资经理', icon: '决' },
    { id: 'executor', name: '交易执行', icon: '执' }, { id: 'reporter', name: '日报归档', icon: '录' },
  ];
  let workflowStages = [], workflowSignature = '';
  const statusLabels = { queued: '等待', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', interrupted: '已中断', pending: '待开始', skipped: '本轮不参与' };
  const runLabels = { queued: '等待启动', researching: '研究进行中', running: '进行中', decided: '目标已保存', executing: '执行核对中', completed: '本轮已结束', failed: '本轮失败', cancelled: '本轮已取消', canceled: '本轮已取消', interrupted: '本轮已中断' };
  const eventLabels = { 'run.queued': '运行排队', 'run.started': '运行开始', 'task.queued': '角色排队', 'task.running': '角色开始', 'task.completed': '角色完成', 'task.failed': '角色失败', 'task.cancelled': '角色取消', 'report.read': '报告读取', 'report.ready': '报告提交', 'decision.saved': '目标保存', 'execution.progress': '执行核对', 'run.finished': '运行结束', 'report.archived': '日报归档', 'tool.started': '工具开始', 'tool.finished': '工具结束' };
  const terminal = new Set(['completed', 'failed', 'cancelled', 'canceled', 'interrupted']);
  const nodeRefs = new Map(), roleLookup = new Map(roles.map(role => [role.id, role]));
  const reportNodes = new Map(), eventNodes = new Map();
  const svgNS = 'http://www.w3.org/2000/svg';
  const string = value => value === null || value === undefined ? '' : String(value);
  const stamp = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const time = value => stamp(value) === null ? '—' : new Date(Number(value)).toLocaleTimeString('zh-CN', { hour12: false });
  const dateTime = value => stamp(value) === null ? '—' : new Date(Number(value)).toLocaleString('zh-CN', { hour12: false });
  const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = string(text); return node; };
  const svg = (tag, attributes = {}) => { const node = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, string(value)); return node; };
  function normalize(data) {
    if (!data || data.schemaVersion !== 1 || !data.run || !['live', 'replay'].includes(data.mode)) throw new Error('协作记录版本或结构不受支持。');
    return { ...data, tasks: Array.isArray(data.tasks) ? data.tasks : [], reports: Array.isArray(data.reports) ? data.reports : [],
      events: (Array.isArray(data.events) ? data.events : []).filter(event => typeof event?.id === 'string' && Number.isSafeInteger(event.seq) && stamp(event.at) !== null).sort((a, b) => a.seq - b.seq) };
  }
  let latest;
  try { latest = normalize(JSON.parse($('activity-data').textContent)); }
  catch (error) { $('data-error').hidden = false; $('data-error').textContent = string(error.message); $('connection-status').textContent = '记录无法读取'; return; }
  let followLive = latest.mode === 'live', playing = false, frozen = false, speed = 1, frozenOutputs = [];
  let selectedRole = 'manager', selectedReport = null, selectionActive = false, cursor = 0, previousFrame = null, lastRenderKey = '', source = null, pendingSnapshot = null;
  const animated = new Set(latest.mode === 'live' ? latest.events.map(event => event.id) : []);
  const pulses = [], media = window.matchMedia('(prefers-reduced-motion: reduce)');
  $('reduce-motion').checked = media.matches;
  let reduced = media.matches;
  document.body.classList.toggle('reduce-motion', reduced);

  function bounds() {
    const values = [latest.run.createdAt, latest.run.startedAt, latest.run.completedAt,
      ...latest.events.map(event => event.at), ...latest.tasks.flatMap(task => [task.createdAt, task.startedAt, task.completedAt]), ...latest.reports.map(report => report.createdAt)].map(stamp).filter(value => value !== null);
    const start = values.length ? Math.min(...values) : stamp(latest.generatedAt) ?? Date.now();
    return { start, end: values.length ? Math.max(start, ...values) : start };
  }
  const initialBounds = bounds(); cursor = initialBounds.end;

  function roleInfo(id) { return roleLookup.get(id) ?? { id, name: string(id), icon: string(id).slice(0, 1) }; }
  function syncWorkflow() {
    const signature = JSON.stringify(latest.workflow ?? null); if (signature === workflowSignature) return false;
    workflowSignature = signature; nodeRefs.clear(); $('role-stages').replaceChildren();
    workflowStages = (Array.isArray(latest.workflow?.stages) ? latest.workflow.stages : []).filter(stage => Number.isSafeInteger(stage.index) && Array.isArray(stage.roles)).map(stage => ({ ...stage, roles: [...new Set(stage.roles.filter(role => typeof role === 'string' && role))] })).sort((a, b) => a.index - b.index);
    $('role-stages').style.gridTemplateColumns = workflowStages.length ? `repeat(${workflowStages.length}, minmax(115px, 1fr))` : '1fr';
    $('diagram').style.minWidth = `${Math.max(640, workflowStages.length * 145 + Math.max(0, workflowStages.length - 1) * 27 + 44)}px`;
    if (!workflowStages.length) $('role-stages').append(element('p', 'workflow-empty', '等待实际工作流配置；没有生成示意任务。'));
    for (const stage of workflowStages) {
    const section = element('div', 'stage'), label = element('p', 'stage-label');
    label.append(element('span', '', String(stage.index + 1).padStart(2, '0')), document.createTextNode(stage.name ?? (stage.roles.length > 1 ? '并行阶段' : roleInfo(stage.roles[0]).name)));
    const list = element('div', 'stage-nodes');
    for (const roleId of stage.roles) {
      const role = roleInfo(roleId), button = element('button', 'agent-node'); button.type = 'button'; button.dataset.role = role.id; button.dataset.stageIndex = String(stage.index);
      const top = element('span', 'node-top'), icon = element('span', 'node-icon', role.icon), name = element('span', 'node-name', role.name);
      icon.setAttribute('aria-hidden', 'true'); top.append(icon, name);
      const model = element('span', 'node-model', '待分配模型'), footer = element('span', 'node-footer'), status = element('span', 'node-status');
      const dot = element('span', 'node-status-dot'), statusText = element('span', '', '待开始'), round = element('span', 'node-round');
      dot.setAttribute('aria-hidden', 'true'); status.append(dot, statusText); footer.append(status, round); button.append(top, model, footer);
      const ref = { button, model, statusText, round, role: role.id, stageIndex: stage.index, taskId: null };
      button.addEventListener('click', () => jumpToReport(role.id, ref.taskId));
      list.append(button); nodeRefs.set(`${stage.index}:${role.id}`, ref);
    }
    section.append(label, list); $('role-stages').append(section);
    }
    return true;
  }
  function refForTask(task) {
    if (!task) return null;
    const explicit = Number.isSafeInteger(task.stageIndex) ? nodeRefs.get(`${task.stageIndex}:${task.role}`) : null; if (explicit) return explicit;
    const candidates = [...nodeRefs.values()].filter(ref => ref.role === task.role);
    return candidates.length === 1 ? candidates[0] : nodeRefs.get(`${task.round}:${task.role}`) ?? null;
  }
  function switchTab(tab) {
    for (const name of ['report', 'event']) { const active = name === tab; $(`${name}-tab`).setAttribute('aria-selected', String(active)); $(`${name}-tab`).tabIndex = active ? 0 : -1; $(`${name}-panel`).hidden = !active; }
  }
  for (const [index, name] of ['report', 'event'].entries()) {
    $(`${name}-tab`).addEventListener('click', () => switchTab(name));
    $(`${name}-tab`).addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const other = event.key === 'Home' ? 'report' : event.key === 'End' ? 'event' : ['report', 'event'][1 - index]; switchTab(other); $(`${other}-tab`).focus(); } });
  }

  function view() {
    const final = followLive && !frozen, events = latest.events.filter(event => final || Number(event.at) <= cursor);
    const firstEvent = new Map(); for (const event of latest.events) if (event.taskId && !firstEvent.has(event.taskId)) firstEvent.set(event.taskId, Number(event.at));
    const tasks = latest.tasks.filter(task => final || (stamp(task.createdAt) ?? firstEvent.get(task.id) ?? Infinity) <= cursor).map(task => {
      if (final) return { ...task };
      let status = 'queued';
      if (stamp(task.startedAt) !== null && Number(task.startedAt) <= cursor) status = 'running';
      if (stamp(task.completedAt) !== null && Number(task.completedAt) <= cursor && terminal.has(task.status)) status = task.status;
      return { ...task, status };
    });
    const byId = new Map(tasks.map(task => [task.id, task]));
    for (const event of events) { const task = byId.get(event.taskId); if (task && event.type.startsWith('task.')) { const status = event.type.slice(5); if (['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)) task.status = status; } }
    const byRole = new Map();
    for (const task of tasks.sort((a, b) => (stamp(a.createdAt) ?? firstEvent.get(a.id) ?? 0) - (stamp(b.createdAt) ?? firstEvent.get(b.id) ?? 0) || Number(a.round ?? 0) - Number(b.round ?? 0))) byRole.set(task.role, task);
    const reports = latest.reports.filter(report => byId.has(report.taskId) && (final || stamp(report.createdAt) !== null && Number(report.createdAt) <= cursor));
    let runStatus = final ? latest.run.status : 'queued';
    if (!final) for (const event of events) {
      if (event.type === 'run.started') runStatus = 'researching';
      if (event.type === 'decision.saved') runStatus = 'decided';
      if (event.type === 'execution.progress') runStatus = 'executing';
      if (event.type === 'run.finished') runStatus = terminal.has(latest.run.status) ? latest.run.status : 'completed';
    }
    const decisionVisible = final || events.some(event => event.type === 'decision.saved');
    const executionVisible = final || events.some(event => event.type === 'execution.progress' || event.type === 'run.finished');
    return { events, tasks, byRole, byId, reports, runStatus, decisionVisible, executionVisible };
  }
  function modelLabel(task) { return task ? [task.provider, task.model].filter(Boolean).join(' / ') || '模型未记录' : '待分配模型'; }
  function modelColor(task) {
    const name = modelLabel(task).toLowerCase();
    if (name.includes('gpt') || name.includes('openai')) return ['#1aa886', '#eaf7f2'];
    if (name.includes('claude') || name.includes('anthropic')) return ['#d88261', '#fcf0e9'];
    if (name.includes('gemini') || name.includes('google')) return ['#5e85cf', '#edf3fd'];
    if (name.includes('deepseek')) return ['#6276c2', '#eef0fb'];
    return ['#758397', '#f1f3f7'];
  }
  function colorize(node, task) { const [color, tint] = modelColor(task); node.style.setProperty('--model-color', color); node.style.setProperty('--model-tint', tint); }
  function renderModels(current) {
    const groups = new Map();
    for (const task of current.byRole.values()) {
      const key = JSON.stringify([task.provider, task.model]); if (!groups.has(key)) groups.set(key, { task, tasks: [] }); groups.get(key).tasks.push(task);
    }
    $('model-summary').replaceChildren(...[...groups.values()].map(group => {
      const button = element('button', `model-summary-button${group.tasks.some(task => task.role === selectedRole) ? ' is-selected' : ''}`); button.type = 'button'; colorize(button, group.task);
      const top = element('span', 'model-summary-top'); top.append(element('span', 'model-summary-icon', string(group.task.model).slice(0, 1).toUpperCase()), element('span', 'model-summary-name', group.task.model), element('span', 'model-summary-chevron', '›'));
      const value = element('div', 'model-summary-value', String(group.tasks.length)); value.append(element('span', '', '位 Agent'));
      const description = element('div', 'model-summary-description', group.tasks.map(task => roleLookup.get(task.role)?.name ?? task.role).join(' · '));
      button.append(top, value, description); button.title = modelLabel(group.task); button.setAttribute('aria-label', `${modelLabel(group.task)}，${group.tasks.length} 个角色。阅读公开报告`);
      button.addEventListener('click', () => { const published = [...current.reports].reverse().find(report => group.tasks.some(task => task.id === report.taskId)); const task = current.byId.get(published?.taskId) ?? group.tasks.find(item => item.status === 'running') ?? group.tasks[0]; jumpToReport(task.role, task.id); }); return button;
    }));
    $('summary-count').textContent = `${current.byRole.size} 个角色 · ${current.reports.length} 份报告`;
  }
  function render(force = false) {
    const workflowChanged = syncWorkflow();
    const current = view(), key = [latest.generatedAt, workflowSignature, cursor, current.events.length, selectedRole, selectedReport, followLive, frozen].join('|');
    if (!force && key === lastRenderKey) return; lastRenderKey = key;
    $('run-title').textContent = string(latest.run.title) || '未命名交易计划';
    $('run-identity').textContent = [string(latest.run.backend).toUpperCase(), string(latest.run.id)].filter(Boolean).join(' · ');
    const phaseLabels = { market: '并行研究中', fundamentals: '并行研究中', news: '并行研究中', sentiment: '并行研究中', bull: '观点辩论中', bear: '观点辩论中', risk: '风险复核中', manager: '决策进行中', executor: '执行核对中', reporter: '日报归档中' };
    const activeRole = [...current.byRole.values()].find(task => task.status === 'running')?.role;
    const archiving = current.runStatus === 'completed' && ['queued', 'running'].includes(current.byRole.get('reporter')?.status);
    $('run-state').textContent = archiving ? '日报归档中' : !terminal.has(current.runStatus) && activeRole ? phaseLabels[activeRole] : runLabels[current.runStatus] ?? (string(current.runStatus) || '状态未记录');
    $('run-state').classList.toggle('is-failed', ['failed', 'interrupted'].includes(current.runStatus));
    const mock = latest.run.mockModelResponses === true, modeLabel = (latest.workflow?.mode ?? latest.run.mode) === 'single' ? '单 Agent 判断' : 'Team 研究协作'; $('mock-banner').hidden = !mock;
    $('mode-badge').textContent = latest.mode === 'replay' ? '历史回放' : modeLabel; $('mode-badge').classList.remove('is-mock');
    const trigger = latest.run.trigger ?? latest.trigger, triggerLabels = { interval: '周期触发', event: '事件触发', manual: '手动触发' };
    $('run-context').textContent = trigger?.kind ? `${triggerLabels[trigger.kind] ?? string(trigger.kind)}${trigger.key ? ` · ${string(trigger.key)}` : ''}` : runLabels[current.runStatus] ?? '实际运行';
    $('display-mode').textContent = `${modeLabel} · 实际任务与公开报告`;
    $('active-count').textContent = String([...current.byRole.values()].filter(task => task.status === 'running').length);
    const tasksByRef = new Map(); for (const task of current.tasks) { const ref = refForTask(task); if (ref) tasksByRef.set(ref, task); }
    for (const ref of nodeRefs.values()) {
      const role = roleInfo(ref.role), task = tasksByRef.get(ref), status = task?.status ?? 'pending'; ref.taskId = task?.id ?? null;
      const selected = selectedReport ? task?.id === selectedReport : selectedRole === role.id;
      ref.button.className = `agent-node${selected ? ' is-selected' : ''}${status === 'running' ? ' is-running' : terminal.has(status) ? status === 'completed' ? ' is-completed' : ' is-failed' : ''}`;
      ref.button.setAttribute('aria-pressed', String(selected)); ref.button.setAttribute('aria-label', `${role.name}，阶段 ${ref.stageIndex + 1}，${statusLabels[status] ?? status}，${modelLabel(task)}。阅读公开报告`);
      ref.model.textContent = task ? string(task.model) || '模型未记录' : '待分配模型'; ref.model.title = modelLabel(task);
      colorize(ref.button, task);
      ref.statusText.textContent = statusLabels[status] ?? string(status); ref.round.textContent = `阶段 ${ref.stageIndex + 1}`;
    }
    const decision = current.decisionVisible ? latest.run.decision : null;
    const targetSummary = (Array.isArray(decision?.targets) ? decision.targets : []).map(target => `${string(target.symbol)} → ${string(target.quantity)} ${target.unit === 'shares' ? '股' : target.unit === 'lots' ? '手' : string(target.unit)}`).join('；');
    $('decision-summary').textContent = !decision ? '尚未保存目标仓位' : decision.unchanged ? `保持当前仓位${targetSummary ? ` · ${targetSummary}` : ''}` : targetSummary || '目标已保存';
    const pausedStrategies = Array.isArray(decision?.pause_strategies) ? decision.pause_strategies : [];
    $('strategy-summary').hidden = pausedStrategies.length === 0;
    $('strategy-summary').textContent = pausedStrategies.length ? `策略动作：暂停挂载 ${pausedStrategies.map(item => string(item.deployment_id)).join('、')}` : '';
    // Only the final record may reveal the final reconciliation result. A progress
    // event before run.finished does not establish a later fill or targetReached.
    const finalExecution = current.executionVisible && (followLive && !frozen || current.events.some(event => event.type === 'run.finished')) ? latest.run.execution : null;
    $('execution-summary').textContent = !current.executionVisible ? '尚无执行记录' : !finalExecution ? '正在核对 · 以回执为准' : finalExecution.targetReached === true ? '目标持仓已观察确认' : finalExecution.status === 'unchanged' ? '持仓保持不变' : finalExecution.status === 'blocked' ? '执行已阻断 · 等待核对' : finalExecution.targetReached === false ? '尚需核对目标持仓' : `${string(finalExecution.status) || '已有回执'} · 未确认成交`;
    renderModels(current); renderFeed(current); renderEvents(current); updateControls(); if (workflowChanged) drawFlows();
  }
  function reconcile(parent, entries, cache, factory) {
    const wanted = new Set(entries.map(entry => entry.key));
    for (let index = parent.children.length - 1; index >= 0; index--) { const child = parent.children[index]; if (!wanted.has(child.dataset.feedKey)) child.remove(); }
    entries.forEach((entry, index) => {
      let cached = cache.get(entry.key);
      if (!cached || cached.signature !== entry.signature) { const node = factory(entry, cached?.node); if (cached && cached.node !== node) cached.node.remove(); node.dataset.feedKey = entry.key; cached = { node, signature: entry.signature }; cache.set(entry.key, cached); }
      if (parent.children[index] !== cached.node) parent.insertBefore(cached.node, parent.children[index] ?? null);
    });
  }
  function renderFeed(current) {
    const readyTasks = new Set(current.events.filter(event => event.type === 'report.ready').map(event => event.taskId));
    const reports = new Map([...current.reports].sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).map(report => [report.taskId, report]));
    const outputs = latest.mode === 'live' && followLive ? frozen ? frozenOutputs : liveOutputs(current) : [];
    const entries = [
      ...[...reports.values()].map(report => ({ key: `task:${report.taskId}`, at: Number(report.createdAt), report, signature: JSON.stringify([report, current.byId.get(report.taskId)?.model, current.byId.get(report.taskId)?.provider, current.byId.get(report.taskId)?.stageIndex, latest.run.mockModelResponses]) })),
      ...outputs.filter(task => !reports.has(task.id) && !readyTasks.has(task.id)).map(task => ({ key: `task:${task.id}`, at: stamp(task.startedAt) ?? stamp(task.createdAt) ?? Infinity, output: task, signature: JSON.stringify([task.publicOutput.text, task.model, task.provider, task.stageIndex, latest.run.mockModelResponses]) })),
      ...current.events.filter(event => event.type === 'report.read').map(event => ({ key: `read:${event.id}`, at: Number(event.at), event, signature: JSON.stringify(event) })),
    ].sort((a, b) => a.at - b.at || Number(a.event?.seq ?? 0) - Number(b.event?.seq ?? 0));
    reconcile($('report-body'), entries, reportNodes, (entry, existing) => {
      if (entry.event) {
        const event = entry.event, row = element('article', 'feed-reading'), body = element('div', 'feed-reading-content');
        const from = latest.tasks.find(task => task.id === event.fromTaskId), to = latest.tasks.find(task => task.id === event.toTaskId);
        body.append(element('p', 'feed-reading-title', from && to ? `${roleInfo(to.role).name}读取了${roleInfo(from.role).name}的报告` : '读取了已记录的公开报告'));
        row.append(element('span', 'feed-reading-icon', '↗'), body, element('time', 'feed-reading-time', time(event.at))); return row;
      }
      const report = entry.report, task = entry.output ?? current.byId.get(report.taskId), role = roleInfo(task?.role ?? report.role), streaming = Boolean(entry.output), row = existing ?? element('article', 'feed-report');
      row.tabIndex = -1; row.dataset.taskId = task?.id ?? report.taskId; row.dataset.role = role.id; row.classList.toggle('is-streaming', streaming); colorize(row, task);
      if (!row.publicParts) {
        const author = element('header', 'feed-author'), detail = element('div', 'feed-author-details'), line = element('div', 'feed-author-line');
        const name = element('h3'), model = element('span', 'feed-model'), mockLabel = element('span', 'feed-mock-label', '回复 mock'), state = element('span', 'feed-output-state', '正在输出'), clock = element('time', 'feed-time'), avatar = element('span', 'feed-avatar'), copy = element('p', 'feed-copy');
        line.append(name, model, mockLabel, state); detail.append(line, clock); author.append(avatar, detail); row.append(author, copy); row.publicParts = { name, model, mockLabel, state, clock, avatar, copy };
      }
      const parts = row.publicParts; parts.name.textContent = role.name; parts.avatar.textContent = role.icon; parts.model.textContent = modelLabel(task); parts.mockLabel.hidden = latest.run.mockModelResponses !== true; parts.state.hidden = !streaming;
      parts.state.textContent = terminal.has(task?.status) ? '已结束的公开输出' : '正在输出';
      parts.clock.textContent = `${streaming ? stamp(task.startedAt) !== null ? `任务开始 ${dateTime(task.startedAt)}` : '公开输出时间未记录' : dateTime(report.createdAt)}${Number.isSafeInteger(task?.stageIndex) ? ` · 阶段 ${task.stageIndex + 1}` : ''}`;
      const text = streaming ? string(task.publicOutput.text) : string(report.text); if (parts.copy.textContent !== text) parts.copy.textContent = text; return row;
    });
    for (const article of $('report-body').children) if (article.classList.contains('feed-report')) article.classList.toggle('is-selected', selectionActive && (selectedReport ? article.dataset.taskId === selectedReport : article.dataset.role === selectedRole));
    const task = selectedReport ? current.byId.get(selectedReport) : current.byRole.get(selectedRole), published = entries.some(entry => entry.report || entry.output ? selectedReport ? (entry.report?.taskId ?? entry.output.id) === selectedReport : (entry.report?.role ?? entry.output.role) === selectedRole : false);
    $('report-waiting').hidden = entries.some(entry => entry.report || entry.output) && (!selectionActive || published);
    $('waiting-title').textContent = selectionActive ? `${roleInfo(selectedRole).name} · 尚未产出公开报告` : '等待 Agent 提交公开报告';
    $('waiting-detail').textContent = selectionActive ? `${modelLabel(task)} · ${statusLabels[task?.status] ?? '待开始'}。报告内容将在实际提交后出现。` : '任务、工具调用和交流以实际运行记录为准。';
    $('report-empty').hidden = entries.length > 0;
  }
  function liveOutputs(current) { return current.tasks.filter(task => typeof task.publicOutput?.text === 'string' && task.publicOutput.text.length > 0); }
  function jumpToReport(role, taskId) {
    selectedRole = role; selectedReport = taskId ?? null; selectionActive = true; switchTab('report'); render(true);
    const articles = [...$('report-body').children].filter(article => article.classList.contains('feed-report') && (taskId ? article.dataset.taskId === taskId : article.dataset.role === role));
    const target = articles.at(-1) ?? $('report-waiting'); target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' }); target.focus({ preventScroll: true });
  }
  function renderEvents(current) {
    $('visible-event-count').textContent = String(current.events.length).padStart(2, '0'); $('event-empty').hidden = current.events.length > 0;
    const dropped = Number.isSafeInteger(latest.droppedEvents) && latest.droppedEvents > 0 ? latest.droppedEvents : 0, truncated = latest.truncated === true || dropped > 0;
    $('history-coverage').hidden = !truncated;
    $('history-coverage').textContent = truncated ? `事件记录已截断${dropped ? ` · ${dropped} 条早期事件未保留` : ''}。这里仅展示保留的记录，早期交流与回放可能不完整。` : '';
    $('event-tab').textContent = truncated ? '已保留事件流水' : '事件流水';
    const entries = current.events.map(event => ({ key: event.id, event, signature: JSON.stringify(event) }));
    reconcile($('event-list'), entries, eventNodes, entry => {
      const event = entry.event;
      const li = element('li', `event-item${event.type === 'report.read' ? ' is-message' : ''}`), head = element('div', 'event-head');
      head.append(element('span', '', eventLabels[event.type] ?? string(event.type)), element('time', '', time(event.at)));
      li.append(head, element('p', 'event-text', event.message)); if (event.detail) li.append(element('p', 'event-detail', event.detail));
      const raw = element('details', 'event-fields'); raw.append(element('summary', '', '原始事件字段'), element('pre', '', JSON.stringify(event, null, 2))); li.append(raw); return li;
    });
  }

  function pathFor(fromRole, toRole) {
    const from = typeof fromRole === 'string' ? nodeRefs.get(fromRole)?.button : fromRole?.button, to = typeof toRole === 'string' ? nodeRefs.get(toRole)?.button : toRole?.button; if (!from || !to) return null;
    const box = $('diagram').getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (from === to) { const x = a.right - box.left, y = a.top - box.top + a.height / 2; return `M ${x} ${y - 10} C ${x + 34} ${y - 42}, ${x + 34} ${y + 42}, ${x} ${y + 10}`; }
    if (Math.abs(a.left - b.left) < 20) {
      const down = a.top < b.top, x = a.left - box.left + a.width / 2, y1 = (down ? a.bottom : a.top) - box.top, y2 = (down ? b.top : b.bottom) - box.top;
      return `M ${x} ${y1} C ${x + 12} ${y1}, ${x + 12} ${y2}, ${x} ${y2}`;
    }
    const forward = a.left < b.left, x1 = (forward ? a.right : a.left) - box.left, x2 = (forward ? b.left : b.right) - box.left, y1 = a.top - box.top + a.height / 2, y2 = b.top - box.top + b.height / 2, bend = Math.max(18, Math.abs(x2 - x1) * .45) * (forward ? 1 : -1);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  function drawFlows() {
    const board = $('diagram'); for (const id of ['flow-lines', 'message-lines']) $(id).setAttribute('viewBox', `0 0 ${board.offsetWidth} ${board.offsetHeight}`);
    const edges = [];
    for (let index = 1; index < workflowStages.length; index++) for (const from of workflowStages[index - 1].roles) for (const to of workflowStages[index].roles) edges.push([`${workflowStages[index - 1].index}:${from}`, `${workflowStages[index].index}:${to}`]);
    $('flow-lines').replaceChildren(...edges.map(([a, b]) => pathFor(a, b)).filter(Boolean).map(d => svg('path', { d, class: 'flow-path' }))); clearPulses();
  }
  function clearPulses() { pulses.splice(0); $('message-lines').replaceChildren(); }
  function pulse(event) {
    if (event.type !== 'report.read') return;
    const from = latest.tasks.find(task => task.id === event.fromTaskId), to = latest.tasks.find(task => task.id === event.toTaskId); if (!from || !to) return;
    const d = pathFor(refForTask(from), refForTask(to)); if (!d) return;
    if (pulses.length >= 8) pulses.shift().group.remove();
    const group = svg('g', { 'data-event-id': event.id }), path = svg('path', { d, class: 'message-route' });
    const title = svg('title'); title.textContent = string(event.message); group.append(title, path);
    const particles = [svg('circle', { r: 3.5, class: 'message-particle' }), svg('circle', { r: 2.4, class: 'message-tail' }), svg('circle', { r: 1.5, class: 'message-tail' })];
    for (const particle of particles) group.append(particle); $('message-lines').append(group);
    pulses.push({ group, path, particles, elapsed: 0, duration: reduced ? 550 : 1300, length: path.getTotalLength() });
  }
  function updateControls() {
    const { start, end } = bounds(), ratio = end > start ? Math.max(0, Math.min(1, (cursor - start) / (end - start))) : 1;
    $('timeline').value = String(Math.round(ratio * 1000)); $('timeline').setAttribute('aria-valuetext', dateTime(cursor));
    $('cursor-time').textContent = dateTime(cursor); $('timeline-start').textContent = time(start); $('timeline-end').textContent = time(end);
    const live = followLive && !frozen;
    $('timeline-mode').textContent = live ? '实时画面' : frozen ? '画面已暂停' : playing ? '历史回放中' : '历史记录';
    const active = live || playing; $('play-symbol').textContent = active ? 'Ⅱ' : '▶'; $('play-label').textContent = live ? '暂停画面' : frozen ? '继续画面' : playing ? '暂停画面' : cursor >= end ? '开始回放' : '继续回放';
    $('play-toggle').setAttribute('aria-pressed', String(!active)); $('live-label').textContent = latest.mode === 'live' ? '返回实时' : '回到最新';
    $('live-button').disabled = latest.mode === 'live' ? live : cursor >= end && !playing;
    document.body.classList.toggle('visual-paused', frozen || !playing && !followLive);
  }
  function replay() { followLive = false; frozen = false; frozenOutputs = []; cursor = bounds().start; playing = true; animated.clear(); clearPulses(); lastRenderKey = ''; render(true); }
  function returnLatest() { if (pendingSnapshot) { latest = pendingSnapshot; pendingSnapshot = null; } followLive = latest.mode === 'live'; frozen = false; frozenOutputs = []; playing = false; cursor = bounds().end; clearPulses(); for (const event of latest.events) animated.add(event.id); render(true); }
  $('replay-button').addEventListener('click', replay); $('live-button').addEventListener('click', returnLatest);
  $('play-toggle').addEventListener('click', () => {
    if (followLive) { if (!frozen) frozenOutputs = liveOutputs(view()); frozen = !frozen; if (!frozen) returnLatest(); else { clearPulses(); render(true); } return; }
    frozen = false; if (!playing && cursor >= bounds().end) replay(); else { playing = !playing; render(true); }
  });
  $('timeline').addEventListener('input', event => {
    const { start, end } = bounds(); followLive = false; frozen = false; frozenOutputs = []; playing = false; cursor = start + (end - start) * Number(event.target.value) / 1000;
    animated.clear(); for (const item of latest.events) if (Number(item.at) <= cursor) animated.add(item.id); clearPulses(); render(true);
  });
  $('speed').addEventListener('change', event => { speed = Number(event.target.value); });
  $('reduce-motion').addEventListener('change', event => { reduced = event.target.checked; document.body.classList.toggle('reduce-motion', reduced); clearPulses(); });

  function connect() {
    if (latest.mode !== 'live') { $('connection-status').textContent = '已保存的运行记录'; return; }
    if (!latest.feedUrl) { $('connection-status').textContent = '实时快照 · 未连接更新流'; return; }
    try {
      const url = new URL(latest.feedUrl, location.href);
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(latest.feedUrl) || url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('更新流必须使用同源相对路径。');
      source = new EventSource(url.href); $('connection-status').textContent = '正在连接';
      source.onopen = () => { $('connection-status').textContent = '更新流已连接'; $('connection-dot').className = 'connection-dot is-connected'; };
      source.onerror = () => { $('connection-status').textContent = source.readyState === EventSource.CLOSED ? '更新流已断开' : '断线 · 正在重连'; $('connection-dot').className = 'connection-dot is-error'; };
      source.addEventListener('snapshot', event => {
        try {
          const next = normalize(JSON.parse(event.data)); if (next.run.id !== latest.run.id) throw new Error('更新记录不属于当前运行。');
          if (frozen) { pendingSnapshot = next; return; }
          latest = next;
          if (followLive && !frozen) { cursor = bounds().end; render(true); for (const item of latest.events) if (!animated.has(item.id)) { animated.add(item.id); pulse(item); } }
        } catch (error) { $('data-error').hidden = false; $('data-error').textContent = `更新未采用：${string(error.message)}`; }
      });
    } catch (error) { $('connection-status').textContent = '更新流不可用'; $('connection-dot').className = 'connection-dot is-error'; $('data-error').hidden = false; $('data-error').textContent = string(error.message); }
  }
  function frame(now) {
    const delta = previousFrame === null ? 0 : Math.min(now - previousFrame, 250); previousFrame = now;
    if (playing && !document.hidden) {
      const end = bounds().end; cursor = Math.min(end, cursor + delta * speed);
      for (const event of latest.events) if (Number(event.at) <= cursor && !animated.has(event.id)) { animated.add(event.id); pulse(event); }
      const visibleCount = latest.events.filter(event => Number(event.at) <= cursor).length;
      if (visibleCount !== Number($('visible-event-count').textContent) || cursor >= end) render(true); else updateControls();
      if (cursor >= end) { playing = false; updateControls(); }
    }
    if (!frozen && (followLive || playing) && !document.hidden) for (let index = pulses.length - 1; index >= 0; index--) {
      const item = pulses[index]; item.elapsed += delta * (followLive ? 1 : speed); const progress = item.elapsed / item.duration;
      if (progress >= 1) { item.group.remove(); pulses.splice(index, 1); continue; }
      item.group.style.opacity = String(progress > .8 ? (1 - progress) / .2 : 1);
      for (const [position, particle] of item.particles.entries()) { const point = item.path.getPointAtLength(Math.max(0, progress - position * .055) * item.length); particle.setAttribute('cx', String(point.x)); particle.setAttribute('cy', String(point.y)); }
    }
    requestAnimationFrame(frame);
  }
  $('speed').value = String(speed);
  for (const name of ['graph', 'reports', 'events', 'playback']) $('nav-' + name).addEventListener('click', () => {
    for (const item of ['graph', 'reports', 'events', 'playback']) { $('nav-' + item).classList.toggle('is-active', item === name); $('nav-' + item).setAttribute('aria-pressed', String(item === name)); }
    if (name === 'reports' || name === 'events') switchTab(name === 'reports' ? 'report' : 'event');
    const target = name === 'playback' ? $('timeline') : name === 'graph' ? $('diagram-title') : $('reader-title');
    target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' }); if (name === 'playback') target.focus({ preventScroll: true });
  });
  render(true); drawFlows(); connect(); requestAnimationFrame(frame);
  if (typeof ResizeObserver === 'function') new ResizeObserver(drawFlows).observe($('diagram')); else window.addEventListener('resize', drawFlows);
  window.addEventListener('pagehide', () => source?.close());
})();
