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
  const statusLabels = { queued: '等待', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', interrupted: '已中断', pending: '待开始', skipped: '不参与' };
  const runLabels = { queued: '等待启动', researching: '研究进行中', running: '进行中', decided: '目标已保存', executing: '执行核对中', completed: '已结束', failed: '运行失败', cancelled: '已取消', canceled: '已取消', interrupted: '已中断' };
  const terminal = new Set(['completed', 'failed', 'cancelled', 'canceled', 'interrupted']);
  const roleLookup = new Map(roles.map(role => [role.id, role])), nodeRefs = new Map(), reportNodes = new Map(), modelNodes = new Map();
  const svgNS = 'http://www.w3.org/2000/svg', pulses = [], motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const string = value => value === null || value === undefined ? '' : String(value);
  const stamp = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const time = value => stamp(value) === null ? '—' : new Date(Number(value)).toLocaleTimeString('zh-CN', { hour12: false });
  const dateTime = value => stamp(value) === null ? '—' : new Date(Number(value)).toLocaleString('zh-CN', { hour12: false });
  const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = string(text); return node; };
  const svg = (tag, attributes = {}) => { const node = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, string(value)); return node; };
  const roleInfo = id => roleLookup.get(id) ?? { id, name: string(id), icon: string(id).slice(0, 1) };
  const modelLabel = task => task ? [task.provider, task.model].filter(Boolean).join(' / ') || '模型未记录' : '待分配模型';
  function colorize(node, task) {
    const name = modelLabel(task).toLowerCase();
    const [color, tint] = name.includes('gpt') || name.includes('openai') ? ['#1aa886', '#eaf7f2']
      : name.includes('claude') || name.includes('anthropic') ? ['#d88261', '#fcf0e9']
      : name.includes('gemini') || name.includes('google') ? ['#5e85cf', '#edf3fd']
      : name.includes('deepseek') ? ['#6276c2', '#eef0fb'] : ['#758397', '#f1f3f7'];
    node.style.setProperty('--model-color', color); node.style.setProperty('--model-tint', tint);
  }
  function normalize(data) {
    if (!data || data.schemaVersion !== 1 || !data.run || !['live', 'archive'].includes(data.mode)) throw new Error('协作记录版本或结构不受支持。');
    return { ...data, tasks: Array.isArray(data.tasks) ? data.tasks : [], reports: Array.isArray(data.reports) ? data.reports : [],
      events: (Array.isArray(data.events) ? data.events : []).filter(event => typeof event?.id === 'string' && Number.isSafeInteger(event.seq) && stamp(event.at) !== null).sort((a, b) => a.seq - b.seq) };
  }
  let latest, workflowStages = [], workflowSignature = '', selectedRole = null, selectedTaskId = null, source = null, previousFrame = null;
  try { latest = normalize(JSON.parse($('activity-data').textContent)); }
  catch (error) { $('data-error').hidden = false; $('data-error').textContent = string(error.message); $('connection-status').textContent = '记录无法读取'; return; }
  let lastAnimatedSeq = latest.events.at(-1)?.seq ?? 0;
  function tasksByRole() {
    const byRole = new Map();
    for (const task of [...latest.tasks].sort((a, b) => (stamp(a.createdAt) ?? 0) - (stamp(b.createdAt) ?? 0) || Number(a.stageIndex ?? a.round ?? 0) - Number(b.stageIndex ?? b.round ?? 0))) byRole.set(task.role, task);
    return byRole;
  }
  function syncWorkflow() {
    const signature = JSON.stringify(latest.workflow ?? null); if (signature === workflowSignature) return false;
    workflowSignature = signature; nodeRefs.clear(); $('role-stages').replaceChildren();
    workflowStages = (Array.isArray(latest.workflow?.stages) ? latest.workflow.stages : []).filter(stage => Number.isSafeInteger(stage.index) && Array.isArray(stage.roles)).map(stage => ({ ...stage, roles: [...new Set(stage.roles.filter(role => typeof role === 'string' && role))] })).sort((a, b) => a.index - b.index);
    $('role-stages').style.gridTemplateColumns = workflowStages.length ? `repeat(${workflowStages.length}, minmax(115px, 1fr))` : '1fr';
    $('diagram').style.minWidth = `${Math.max(640, workflowStages.length * 145 + Math.max(0, workflowStages.length - 1) * 27 + 44)}px`;
    if (!workflowStages.length) $('role-stages').append(element('p', 'workflow-empty', '等待工作流'));
    for (const stage of workflowStages) {
      const section = element('div', 'stage'), label = element('p', 'stage-label');
      label.append(element('span', '', String(stage.index + 1).padStart(2, '0')), document.createTextNode(stage.name ?? (stage.roles.length > 1 ? '并行阶段' : roleInfo(stage.roles[0]).name)));
      const list = element('div', 'stage-nodes');
      for (const roleId of stage.roles) {
        const role = roleInfo(roleId), button = element('button', 'agent-node'); button.type = 'button'; button.dataset.role = role.id; button.dataset.stageIndex = String(stage.index);
        const top = element('span', 'node-top'), icon = element('span', 'node-icon', role.icon), name = element('span', 'node-name', role.name); icon.setAttribute('aria-hidden', 'true'); top.append(icon, name);
        const model = element('span', 'node-model', '待分配模型'), footer = element('span', 'node-footer'), status = element('span', 'node-status');
        const dot = element('span', 'node-status-dot'), statusText = element('span', '', '待开始'), tool = element('span', 'node-tool'); dot.setAttribute('aria-hidden', 'true'); status.append(dot, statusText); footer.append(status); button.append(top, model, footer, tool);
        const ref = { button, model, statusText, tool, role: role.id, stageIndex: stage.index, taskId: null };
        button.addEventListener('click', () => jumpToReport(role.id, ref.taskId)); list.append(button); nodeRefs.set(`${stage.index}:${role.id}`, ref);
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
  function reconcile(parent, entries, cache, factory) {
    const wanted = new Set(entries.map(entry => entry.key));
    for (let index = parent.children.length - 1; index >= 0; index--) { const child = parent.children[index]; if (!wanted.has(child.dataset.feedKey)) child.remove(); }
    for (const key of cache.keys()) if (!wanted.has(key)) cache.delete(key);
    entries.forEach((entry, index) => {
      let cached = cache.get(entry.key);
      if (!cached || cached.signature !== entry.signature) { const node = factory(entry, cached?.node); if (cached && cached.node !== node) cached.node.remove(); node.dataset.feedKey = entry.key; cached = { node, signature: entry.signature }; cache.set(entry.key, cached); }
      if (parent.children[index] !== cached.node) parent.insertBefore(cached.node, parent.children[index] ?? null);
    });
  }
  function renderModels(byRole) {
    const groups = new Map();
    for (const task of byRole.values()) { const key = JSON.stringify([task.provider, task.model]); if (!groups.has(key)) groups.set(key, { task, tasks: [] }); groups.get(key).tasks.push(task); }
    const entries = [...groups].map(([key, group]) => ({ key, group, signature: JSON.stringify([group.tasks, selectedRole]) }));
    reconcile($('model-summary'), entries, modelNodes, (entry, existing) => {
      const group = entry.group, button = existing ?? element('button', 'model-summary-button'); button.type = 'button'; button.modelGroup = group;
      colorize(button, group.task);
      button.classList.toggle('is-selected', group.tasks.some(task => task.role === selectedRole));
      if (!button.modelParts) {
        const top = element('span', 'model-summary-top'), name = element('span', 'model-summary-name'), value = element('div', 'model-summary-value'), count = element('span'), unit = element('span', '', '位 Agent'), description = element('div', 'model-summary-description');
        top.append(name); value.append(count, unit); button.append(top, value, description); button.modelParts = { name, count, description };
        button.addEventListener('click', () => { const current = button.modelGroup, published = [...latest.reports].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).find(report => current.tasks.some(task => task.id === report.taskId)); const task = current.tasks.find(item => item.id === published?.taskId) ?? current.tasks.find(item => item.status === 'running') ?? current.tasks[0]; jumpToReport(task.role, task.id); });
      }
      button.modelParts.name.textContent = string(group.task.model) || '模型未记录'; button.modelParts.count.textContent = String(group.tasks.length); button.modelParts.description.textContent = group.tasks.map(task => roleInfo(task.role).name).join(' · ');
      button.title = modelLabel(group.task); button.setAttribute('aria-label', `${modelLabel(group.task)}，${group.tasks.length} 个角色，定位公开报告`); return button;
    });
  }
  function renderFeed(byRole) {
    const byId = new Map(latest.tasks.map(task => [task.id, task])), readyTasks = new Set(latest.events.filter(event => event.type === 'report.ready').map(event => event.taskId));
    const reports = new Map([...latest.reports].sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).map(report => [report.taskId, report]));
    const outputs = latest.mode === 'live' ? latest.tasks.filter(task => typeof task.publicOutput?.text === 'string' && task.publicOutput.text.length > 0 && !reports.has(task.id) && !readyTasks.has(task.id)) : [];
    const entries = [
      ...[...reports.values()].map(report => ({ key: `task:${report.taskId}`, at: stamp(report.createdAt) ?? Infinity, report, signature: JSON.stringify([report, byId.get(report.taskId)]) })),
      ...outputs.map(task => ({ key: `task:${task.id}`, at: stamp(task.startedAt) ?? stamp(task.createdAt) ?? Infinity, output: task, signature: JSON.stringify(task) })),
      ...latest.events.filter(event => event.type === 'report.read').map(event => ({ key: `read:${event.id}`, at: Number(event.at), event, signature: JSON.stringify([event, byId.get(event.fromTaskId)?.role, byId.get(event.toTaskId)?.role]) })),
    ].sort((a, b) => a.at - b.at || Number(a.event?.seq ?? 0) - Number(b.event?.seq ?? 0));
    reconcile($('report-body'), entries, reportNodes, (entry, existing) => {
      if (entry.event) {
        const event = entry.event, row = element('article', 'feed-reading'), from = byId.get(event.fromTaskId), to = byId.get(event.toTaskId);
        row.append(element('p', 'feed-reading-title', from && to ? `${roleInfo(to.role).name}读取了${roleInfo(from.role).name}的报告` : '读取了公开报告'), element('time', 'feed-reading-time', time(event.at))); return row;
      }
      const report = entry.report, task = entry.output ?? byId.get(report.taskId), role = roleInfo(task?.role ?? report.role), streaming = Boolean(entry.output), row = existing ?? element('article', 'feed-report');
      colorize(row, task ?? report);
      row.tabIndex = -1; row.dataset.taskId = task?.id ?? report.taskId; row.dataset.role = role.id; row.classList.toggle('is-streaming', streaming);
      if (!row.publicParts) {
        const author = element('header', 'feed-author'), detail = element('div', 'feed-author-details'), line = element('div', 'feed-author-line');
        const name = element('h3'), model = element('span', 'feed-model'), state = element('span', 'feed-output-state'), clock = element('time', 'feed-time'), copy = element('p', 'feed-copy');
        line.append(name, model, state); detail.append(line, clock); author.append(detail); row.append(author, copy); row.publicParts = { name, model, state, clock, copy };
      }
      const parts = row.publicParts; parts.name.textContent = role.name; parts.model.textContent = modelLabel(task ?? report); parts.state.hidden = !streaming; parts.state.textContent = task?.status === 'running' ? '正在输出' : '公开输出';
      parts.clock.textContent = streaming ? stamp(task.startedAt) !== null ? `任务开始 ${dateTime(task.startedAt)}` : '输出时间未记录' : dateTime(report.createdAt);
      const text = streaming ? task.publicOutput.text : string(report.text); if (parts.copy.textContent !== text) parts.copy.textContent = text; return row;
    });
    for (const article of $('report-body').children) if (article.classList.contains('feed-report')) article.classList.toggle('is-selected', selectedRole !== null && (selectedTaskId ? article.dataset.taskId === selectedTaskId : article.dataset.role === selectedRole));
    const selectedTask = selectedTaskId ? byId.get(selectedTaskId) : byRole.get(selectedRole), published = entries.some(entry => entry.report || entry.output ? selectedTaskId ? (entry.report?.taskId ?? entry.output.id) === selectedTaskId : (entry.report?.role ?? entry.output.role) === selectedRole : false);
    $('report-waiting').hidden = entries.some(entry => entry.report || entry.output) && (selectedRole === null || published);
    $('waiting-title').textContent = selectedRole !== null ? `${roleInfo(selectedRole).name} · ${statusLabels[selectedTask?.status] ?? '等待报告'}` : '等待公开报告';
    $('waiting-detail').hidden = selectedRole === null; $('waiting-detail').textContent = selectedRole !== null ? modelLabel(selectedTask) : '';
  }
  function render() {
    const workflowChanged = syncWorkflow(), byRole = tasksByRole();
    $('run-title').textContent = string(latest.run.title) || '未命名交易计划';
    const activeRole = [...byRole.values()].find(task => task.status === 'running')?.role, phaseLabels = { market: '并行研究中', fundamentals: '并行研究中', news: '并行研究中', sentiment: '并行研究中', bull: '观点辩论中', bear: '观点辩论中', risk: '风险复核中', manager: '决策进行中', executor: '执行核对中', reporter: '日报归档中' };
    const archiving = latest.run.status === 'completed' && ['queued', 'running'].includes(byRole.get('reporter')?.status);
    $('run-state').textContent = archiving ? '日报归档中' : !terminal.has(latest.run.status) && activeRole ? phaseLabels[activeRole] ?? '进行中' : runLabels[latest.run.status] ?? string(latest.run.status);
    $('run-state').classList.toggle('is-failed', ['failed', 'interrupted'].includes(latest.run.status));
    $('mode-badge').textContent = latest.mode === 'archive' ? '运行记录' : (latest.workflow?.mode ?? latest.run.mode) === 'single' ? '单 Agent' : 'Team 协作'; $('mock-label').hidden = latest.run.mockModelResponses !== true;
    const trigger = latest.run.trigger ?? latest.trigger, triggerLabels = { interval: '周期触发', event: '事件触发', manual: '手动触发' };
    $('run-context').textContent = trigger?.kind ? `${triggerLabels[trigger.kind] ?? string(trigger.kind)}${trigger.key ? ` · ${string(trigger.key)}` : ''}` : '';
    $('active-count').textContent = String(latest.tasks.filter(task => task.status === 'running').length);
    const tasksByRef = new Map(); for (const task of latest.tasks) { const ref = refForTask(task); if (ref) tasksByRef.set(ref, task); }
    const toolsByTask = new Map(); for (const event of latest.events) if (event.taskId && ['tool.started', 'tool.finished'].includes(event.type)) toolsByTask.set(event.taskId, event);
    for (const ref of nodeRefs.values()) {
      const role = roleInfo(ref.role), task = tasksByRef.get(ref), status = task?.status ?? 'pending'; ref.taskId = task?.id ?? null;
      colorize(ref.button, task);
      const selected = selectedTaskId ? task?.id === selectedTaskId : selectedRole === role.id;
      ref.button.className = `agent-node${selected ? ' is-selected' : ''}${status === 'running' ? ' is-running' : terminal.has(status) ? status === 'completed' ? ' is-completed' : ' is-failed' : ''}`;
      ref.button.setAttribute('aria-pressed', String(selected)); ref.button.setAttribute('aria-label', `${role.name}，阶段 ${ref.stageIndex + 1}，${statusLabels[status] ?? status}，${modelLabel(task)}，定位公开报告`);
      ref.model.textContent = task ? string(task.model) || '模型未记录' : '待分配模型'; ref.model.title = modelLabel(task); ref.statusText.textContent = statusLabels[status] ?? string(status);
      const tool = toolsByTask.get(task?.id), toolActive = status === 'running' && tool?.type === 'tool.started'; ref.tool.hidden = !toolActive; ref.tool.textContent = toolActive ? string(tool.message) : ''; ref.tool.title = ref.tool.textContent;
    }
    const dropped = Number.isSafeInteger(latest.droppedEvents) && latest.droppedEvents > 0 ? latest.droppedEvents : 0, truncated = latest.truncated === true || dropped > 0;
    $('history-coverage').hidden = !truncated; $('history-coverage').textContent = truncated ? `早期事件已截断${dropped ? `（${dropped} 条）` : ''}` : '';
    renderModels(byRole); renderFeed(byRole); if (workflowChanged) drawFlows();
  }
  function jumpToReport(role, taskId) {
    selectedRole = role; selectedTaskId = taskId ?? null; render();
    const articles = [...$('report-body').children].filter(article => article.classList.contains('feed-report') && (taskId ? article.dataset.taskId === taskId : article.dataset.role === role));
    const target = articles.at(-1) ?? $('report-waiting'); target.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' }); target.focus({ preventScroll: true });
  }
  function pathFor(fromRef, toRef) {
    const from = fromRef?.button, to = toRef?.button; if (!from || !to) return null;
    const box = $('diagram').getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (from === to) { const x = a.right - box.left, y = a.top - box.top + a.height / 2; return `M ${x} ${y - 10} C ${x + 34} ${y - 42}, ${x + 34} ${y + 42}, ${x} ${y + 10}`; }
    if (Math.abs(a.left - b.left) < 20) { const down = a.top < b.top, x = a.left - box.left + a.width / 2, y1 = (down ? a.bottom : a.top) - box.top, y2 = (down ? b.top : b.bottom) - box.top; return `M ${x} ${y1} C ${x + 12} ${y1}, ${x + 12} ${y2}, ${x} ${y2}`; }
    const forward = a.left < b.left, x1 = (forward ? a.right : a.left) - box.left, x2 = (forward ? b.left : b.right) - box.left, y1 = a.top - box.top + a.height / 2, y2 = b.top - box.top + b.height / 2, bend = Math.max(18, Math.abs(x2 - x1) * .45) * (forward ? 1 : -1);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  function clearPulses() { pulses.splice(0); $('message-lines').replaceChildren(); }
  function drawFlows() {
    const board = $('diagram'); for (const id of ['flow-lines', 'message-lines']) $(id).setAttribute('viewBox', `0 0 ${board.offsetWidth} ${board.offsetHeight}`);
    const paths = []; for (let index = 1; index < workflowStages.length; index++) for (const from of workflowStages[index - 1].roles) for (const to of workflowStages[index].roles) { const d = pathFor(nodeRefs.get(`${workflowStages[index - 1].index}:${from}`), nodeRefs.get(`${workflowStages[index].index}:${to}`)); if (d) paths.push(svg('path', { d, class: 'flow-path' })); }
    $('flow-lines').replaceChildren(...paths); clearPulses();
  }
  function pulse(event) {
    if (event.type !== 'report.read') return;
    const from = latest.tasks.find(task => task.id === event.fromTaskId), to = latest.tasks.find(task => task.id === event.toTaskId), d = pathFor(refForTask(from), refForTask(to)); if (!d) return;
    if (pulses.length >= 8) pulses.shift().group.remove();
    const group = svg('g', { 'data-event-id': event.id }), path = svg('path', { d, class: 'message-route' }), title = svg('title'); title.textContent = string(event.message); group.append(title, path);
    const particle = svg('circle', { r: 3.5, class: 'message-particle' }); if (!motion.matches) group.append(particle); $('message-lines').append(group);
    pulses.push({ group, path, particle, elapsed: 0, duration: motion.matches ? 550 : 1300, length: path.getTotalLength() });
  }
  function connect() {
    if (latest.mode !== 'live') { $('connection-status').textContent = '已保存'; return; }
    if (!latest.feedUrl) { $('connection-status').textContent = '快照'; return; }
    try {
      const url = new URL(latest.feedUrl, location.href);
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(latest.feedUrl) || url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('更新流必须使用同源相对路径。');
      source = new EventSource(url.href); $('connection-status').textContent = '正在连接';
      source.onopen = () => { $('connection-status').textContent = '已连接'; $('connection-dot').className = 'connection-dot is-connected'; };
      source.onerror = () => { $('connection-status').textContent = source.readyState === EventSource.CLOSED ? '已断开' : '正在重连'; $('connection-dot').className = 'connection-dot is-error'; };
      source.addEventListener('snapshot', event => {
        try {
          const next = normalize(JSON.parse(event.data)); if (next.run.id !== latest.run.id) throw new Error('更新记录不属于当前运行。');
          latest = next; render(); for (const item of latest.events) if (item.seq > lastAnimatedSeq) pulse(item); lastAnimatedSeq = Math.max(lastAnimatedSeq, latest.events.at(-1)?.seq ?? 0);
        } catch (error) { $('data-error').hidden = false; $('data-error').textContent = `更新未采用：${string(error.message)}`; }
      });
    } catch (error) { $('connection-status').textContent = '更新不可用'; $('connection-dot').className = 'connection-dot is-error'; $('data-error').hidden = false; $('data-error').textContent = string(error.message); }
  }
  function frame(now) {
    const delta = previousFrame === null ? 0 : Math.min(now - previousFrame, 250); previousFrame = now;
    if (!document.hidden) for (let index = pulses.length - 1; index >= 0; index--) {
      const item = pulses[index]; item.elapsed += delta; const progress = item.elapsed / item.duration;
      if (progress >= 1) { item.group.remove(); pulses.splice(index, 1); continue; }
      if (!motion.matches) { const point = item.path.getPointAtLength(progress * item.length); item.particle.setAttribute('cx', String(point.x)); item.particle.setAttribute('cy', String(point.y)); }
    }
    requestAnimationFrame(frame);
  }
  render(); drawFlows(); connect(); requestAnimationFrame(frame);
  if (typeof ResizeObserver === 'function') new ResizeObserver(drawFlows).observe($('diagram')); else window.addEventListener('resize', drawFlows);
  motion.addEventListener?.('change', clearPulses); window.addEventListener('pagehide', () => source?.close());
})();
