// Move existing disclosures, never their data copies. Async chart/table handlers
// keep the same elements; removing a dynamic owner also removes its old appendix.
(function () {
  'use strict';
  if (window.SesameAppendix) { window.SesameAppendix.collect(); return; }
  const zh = /^zh/i.test(document.documentElement.lang);
  const text = (cn, en) => zh ? cn : en;
  const records = new Map();
  let serial = 0, busy = false, queued = false;
  const rootFor = node => node.closest('[data-report-appendix-root]') || node.closest('main') || document.querySelector('main');
  const inline = node => Boolean(node.closest('[data-report-evidence-layout="inline"], [data-report-disclosure="controls"]'));
  // Unclassified custom controls are left where their author put them. Custom
  // evidence opts in; built-in evidence components have explicit known classes.
  const evidence = node => node.matches('[data-report-evidence], .module-field, .module-more, .module-chart-inspect, .module-value-details, .report-reasoning-details, .kit-appendix, .kit-more, .report-inspect') || Boolean(node.closest('.module-history'));
  const setHash = id => { try { history.replaceState(null, '', `#${id}`); } catch { /* Opaque report sandboxes may forbid history edits; scrolling remains available. */ } };
  const uniqueId = prefix => { let value; do { value = `${prefix}-${++serial}`; } while (document.getElementById(value) || document.getElementById(`${value}-ref`)); return value; };
  function appendix(root) {
    let section = [...root.children].find(child => child.hasAttribute('data-report-evidence-appendix'));
    if (!section) {
      section = document.createElement('section'); section.className = 'report-evidence-appendix'; section.setAttribute('data-report-evidence-appendix', '');
      const title = document.createElement('h2'); title.textContent = text('附录 · 证据与原始明细', 'Appendix · Evidence and original records'); section.append(title); root.append(section);
    }
    return section;
  }
  function collect() {
    if (busy) return;
    busy = true;
    try {
      for (const [detail, record] of records) {
        if (!record.marker.isConnected || !record.entry.isConnected) {
          record.entry.remove(); record.link.remove();
          if (!record.links.children.length) record.links.remove();
          records.delete(detail);
        }
      }
      const candidates = [...document.querySelectorAll('main details, [data-report-appendix-root] details')].filter(detail =>
        !detail.closest('[data-report-evidence-appendix]') && evidence(detail) && !inline(detail) && !detail.parentElement.closest('details'));
      for (const detail of candidates) {
        const root = rootFor(detail); if (!root || inline(root)) continue;
        const summary = [...detail.children].find(child => child.tagName === 'SUMMARY'); if (!summary) continue;
        const owner = detail.parentElement.closest('[data-report-evidence-context], .module-field, .report-reasoning, .trial-detail, .kit-section, section, article') || root;
        const heading = document.getElementById(owner.getAttribute('aria-labelledby')) || [...owner.children].find(node => /^H[234]$/.test(node.tagName));
        const section = owner.closest('.module-section, .kit-section');
        const sectionHeading = section && [...section.children].find(node => /^H[23]$/.test(node.tagName));
        const context = detail.getAttribute('data-report-evidence-context') || owner.getAttribute('data-report-evidence-context') || heading?.textContent?.trim() || sectionHeading?.textContent?.trim() || '';
        const title = summary.textContent.trim(), id = uniqueId('report-evidence');
        const marker = document.createComment('evidence in end appendix'); detail.before(marker);
        let links = [...owner.children].find(child => child.classList.contains('report-evidence-links'));
        if (!links) { links = document.createElement('nav'); links.className = 'report-evidence-links'; links.setAttribute('aria-label', text('本节依据', 'Evidence for this section')); owner.append(links); }
        const link = document.createElement('a'); link.id = `${id}-ref`; link.href = `#${id}`;
        link.textContent = `${text('依据', 'Evidence')} ${serial}`; link.title = title; link.setAttribute('aria-label', `${text('查看附录', 'View appendix')} ${serial}: ${context ? `${context} · ` : ''}${title}`); links.append(link);
        const entry = document.createElement('div'); entry.id = id; entry.className = 'report-evidence-entry'; entry.tabIndex = -1;
        const prefix = document.createElement('span'); prefix.className = 'report-evidence-context'; prefix.textContent = `${serial}. ${context ? `${context} · ` : ''}`; summary.prepend(prefix);
        const back = document.createElement('a'); back.href = `#${link.id}`; back.className = 'report-evidence-return'; back.textContent = text('返回正文 ↑', 'Back to reading ↑');
        detail.append(back); entry.append(detail); appendix(root).append(entry);
        records.set(detail, { marker, entry, link, links, root });
        link.addEventListener('click', event => { event.preventDefault(); reveal(detail); });
        back.addEventListener('click', event => {
          event.preventDefault();
          const trial = link.closest('[data-trial-detail]');
          if (trial?.hidden) root.dispatchEvent(new CustomEvent('report-evidence-return', { bubbles: true, detail: { trial: trial.dataset.trialDetail } }));
          link.scrollIntoView({ block: 'center' }); link.focus({ preventScroll: true });
          setHash(link.id);
        });
      }
      for (const section of document.querySelectorAll('[data-report-evidence-appendix]')) {
        if (!section.querySelector('.report-evidence-entry')) section.remove();
        else if (section.parentElement.lastElementChild !== section) section.parentElement.append(section);
      }
    } finally { busy = false; }
  }
  function reveal(detail) {
    collect();
    for (let node = detail; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
    const entry = records.get(detail)?.entry || detail.closest('.report-evidence-entry') || detail;
    entry.scrollIntoView({ block: 'start' }); entry.focus({ preventScroll: true });
    if (entry.id) setHash(entry.id);
  }
  function fromHash() {
    const target = document.getElementById(location.hash.slice(1));
    const entry = target?.closest('.report-evidence-entry');
    if (entry) reveal(target.tagName === 'DETAILS' ? target : entry.querySelector('details'));
  }
  window.SesameAppendix = Object.freeze({ collect, reveal });
  collect(); fromHash();
  const observer = new MutationObserver(() => {
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; collect(); }); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
