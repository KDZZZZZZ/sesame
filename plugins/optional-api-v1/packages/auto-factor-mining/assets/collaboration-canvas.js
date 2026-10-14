(() => {
  'use strict';
  const MIN_SCALE = .1, MAX_SCALE = 3, PADDING = 20;
  const clamp = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));

  window.SesameGraphCanvas = class {
    constructor(viewport, scene) {
      this.viewport = viewport; this.scene = scene;
      this.view = { x: 0, y: 0, scale: 1 }; this.autoFit = true;
      this.pointers = new Map(); this.moved = false; this.suppressClick = false;
      this.controls = Object.fromEntries(['zoom-in', 'zoom-out', 'fit', 'reset', 'zoom-level'].map(key => [key, document.getElementById(`graph-${key}`)]));
      this.controls['zoom-in'].addEventListener('click', () => this.zoom(1.2));
      this.controls['zoom-out'].addEventListener('click', () => this.zoom(1 / 1.2));
      this.controls.fit.addEventListener('click', () => this.fit());
      this.controls.reset.addEventListener('click', () => this.reset());
      viewport.addEventListener('pointerdown', event => this.start(event));
      viewport.addEventListener('pointermove', event => this.move(event));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, event => this.end(event));
      viewport.addEventListener('click', event => {
        if (this.suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); this.suppressClick = false; }
      }, true);
      viewport.addEventListener('wheel', event => {
        if (!event.deltaY) return;
        event.preventDefault(); if (this.pointers.size) return;
        const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        this.zoom(Math.exp(-Math.max(-240, Math.min(240, event.deltaY * units)) * .0025), this.point(event));
      }, { passive: false });
      viewport.addEventListener('keydown', event => this.key(event));
      viewport.addEventListener('focusin', event => {
        const node = event.target.closest?.('.agent-node');
        if (!node || this.pointers.size || !node.matches(':focus-visible')) return;
        const bounds = viewport.getBoundingClientRect(), target = node.getBoundingClientRect();
        if (target.left >= bounds.left + 8 && target.right <= bounds.right - 8 && target.top >= bounds.top + 8 && target.bottom <= bounds.bottom - 8) return;
        this.autoFit = false;
        this.view.x += bounds.left + bounds.width / 2 - target.left - target.width / 2;
        this.view.y += bounds.top + bounds.height / 2 - target.top - target.height / 2;
        this.apply();
      });
      window.addEventListener('blur', () => { for (const pointerId of this.pointers.keys()) this.end({ pointerId }); });
    }

    get scale() { return this.view.scale; }
    point(event) { const rect = this.viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
    center() { return { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 }; }
    apply() {
      const { x, y, scale } = this.view;
      this.scene.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      this.controls['zoom-level'].textContent = `${Math.round(scale * 100)}%`;
      this.controls['zoom-in'].disabled = scale >= MAX_SCALE - 1e-6;
      this.controls['zoom-out'].disabled = scale <= MIN_SCALE + 1e-6;
    }
    fit() {
      const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
      if (!width || !height || !this.scene.offsetWidth || !this.scene.offsetHeight) return;
      this.autoFit = true;
      const scale = clamp(Math.min(1, (width - PADDING * 2) / this.scene.offsetWidth, (height - PADDING * 2) / this.scene.offsetHeight));
      this.view = { scale, x: (width - this.scene.offsetWidth * scale) / 2, y: (height - this.scene.offsetHeight * scale) / 2 };
      this.apply();
    }
    reset() {
      this.autoFit = false;
      this.view = { scale: 1, x: (this.viewport.clientWidth - this.scene.offsetWidth) / 2, y: (this.viewport.clientHeight - this.scene.offsetHeight) / 2 };
      this.apply();
    }
    zoom(factor, origin = this.center()) {
      const scale = clamp(this.view.scale * factor), ratio = scale / this.view.scale;
      this.autoFit = false;
      this.view = { scale, x: origin.x - (origin.x - this.view.x) * ratio, y: origin.y - (origin.y - this.view.y) * ratio };
      this.apply();
    }
    refresh() {
      const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
      if (this.autoFit) this.fit();
      else if (this.size) {
        this.view.x += (width - this.size.width) / 2; this.view.y += (height - this.size.height) / 2; this.apply();
      }
      this.size = { width, height };
    }
    geometry() {
      const points = [...this.pointers.values()];
      if (points.length === 1) return { center: points[0], distance: 0 };
      const [a, b] = points;
      return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }
    rebase() { this.gesture = this.pointers.size ? { ...this.geometry(), view: { ...this.view } } : null; }
    start(event) {
      if (event.button !== 0 || this.pointers.has(event.pointerId)) return;
      if (!this.pointers.size) { this.moved = false; this.suppressClick = false; }
      const capture = event.target.closest?.('.agent-node') ?? this.viewport;
      this.pointers.set(event.pointerId, { ...this.point(event), capture });
      capture.setPointerCapture(event.pointerId);
      if (this.pointers.size > 1) { this.moved = true; this.suppressClick = true; this.autoFit = false; }
      this.rebase(); this.viewport.classList.toggle('is-dragging', this.moved);
    }
    move(event) {
      const previous = this.pointers.get(event.pointerId); if (!previous || !this.gesture) return;
      this.pointers.set(event.pointerId, { ...this.point(event), capture: previous.capture });
      const { center, distance } = this.geometry(), base = this.gesture;
      if (!this.moved && Math.hypot(center.x - base.center.x, center.y - base.center.y) < 4) return;
      this.moved = true; this.suppressClick = true; this.autoFit = false;
      event.preventDefault();
      const scale = this.pointers.size > 1 ? clamp(base.view.scale * distance / Math.max(1, base.distance)) : base.view.scale;
      this.view = { scale,
        x: center.x - (base.center.x - base.view.x) / base.view.scale * scale,
        y: center.y - (base.center.y - base.view.y) / base.view.scale * scale };
      this.viewport.classList.add('is-dragging'); this.apply();
    }
    end(event) {
      const pointer = this.pointers.get(event.pointerId); if (!pointer) return;
      this.pointers.delete(event.pointerId);
      if (pointer.capture.hasPointerCapture(event.pointerId)) pointer.capture.releasePointerCapture(event.pointerId);
      this.rebase(); this.viewport.classList.toggle('is-dragging', this.pointers.size > 0 && this.moved);
    }
    key(event) {
      if (event.target !== this.viewport || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['+', '='].includes(event.key)) this.zoom(1.2);
      else if (event.key === '-') this.zoom(1 / 1.2);
      else if (['0', 'Home'].includes(event.key)) this.fit();
      else if (event.key === '1') this.reset();
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const delta = event.shiftKey ? 100 : 40; this.autoFit = false;
        this.view.x += event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0;
        this.view.y += event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0;
        this.apply();
      } else return;
      event.preventDefault();
    }
  };
})();
