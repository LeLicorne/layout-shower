// Layout Shower — moteur de rendu injecté dans la page.
// Dessine margin / border / padding / content sur un canvas plein écran isolé en Shadow DOM.
(() => {
  'use strict';
  if (window.__layoutShower) return;

  const LAYERS = ['margin', 'border', 'padding'];
  const COLORS = {
    margin: { rgb: '246,178,107', line: '#c9731f' },
    border: { rgb: '255,221,120', line: '#b08a12' },
    padding: { rgb: '147,196,125', line: '#4f8a35' },
    content: { rgb: '111,168,220', line: '#2f6fae' },
  };
  // Position relative des étiquettes le long d'un côté, pour que les couches ne se superposent pas.
  const STAGGER = { margin: 0.2, border: 0.5, padding: 0.8 };
  const ALPHA = {
    hover: { margin: 0.55, border: 0.7, padding: 0.55, content: 0.45 },
    all: { margin: 0.3, border: 0.5, padding: 0.3, content: 0.7 },
  };
  const MAX_ELEMENTS = 3000;
  const MIN_LABEL_ALL = 4;
  const LABEL_H = 16;
  const GAP = 6;
  const FONT = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const SKIP = new Set([
    'script', 'style', 'link', 'meta', 'head', 'title', 'noscript', 'template',
    'br', 'wbr', 'option', 'source', 'track', 'param',
  ]);

  const state = {
    enabled: false,
    mode: 'hover',
    layers: { margin: true, border: true, padding: true, content: true },
  };

  let host = null;
  let canvas = null;
  let ctx = null;
  let viewport = { w: 0, h: 0 };
  let metricsCache = new WeakMap();
  const widthCache = new Map();
  let rafId = 0;
  let mouse = null;
  let hovered = null;
  let observer = null;
  let placed = [];

  const rt = typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage ? browser : null;

  // ---------- état ----------

  const snapshot = () => ({ enabled: state.enabled, mode: state.mode, layers: { ...state.layers } });

  function apply(next = {}) {
    const wasEnabled = state.enabled;
    if (next.mode === 'hover' || next.mode === 'all') state.mode = next.mode;
    if (next.layers) state.layers = { ...state.layers, ...next.layers };
    if (typeof next.enabled === 'boolean') state.enabled = next.enabled;

    if (state.enabled && !wasEnabled) start();
    else if (!state.enabled && wasEnabled) stop();
    else if (state.enabled) schedule();
    return snapshot();
  }

  function start() {
    mount();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.addEventListener('keydown', onKeyDown, true);
    observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    schedule();
  }

  function stop() {
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove, { capture: true });
    window.removeEventListener('keydown', onKeyDown, true);
    if (observer) observer.disconnect();
    observer = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (host) host.remove();
    host = canvas = ctx = null;
    hovered = null;
    metricsCache = new WeakMap();
  }

  function mount() {
    host = document.createElement('div');
    host.setAttribute('data-layout-shower', '');
    host.style.cssText = [
      'all:initial', 'position:fixed', 'inset:0', 'width:100%', 'height:100%',
      'margin:0', 'padding:0', 'border:0', 'background:transparent', 'overflow:hidden',
      'pointer-events:none', 'z-index:2147483647', 'display:block',
    ].map((d) => d + ' !important').join(';');
    const root = host.attachShadow({ mode: 'closed' });
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    root.appendChild(canvas);
    document.documentElement.appendChild(host);
    // Top layer : passe au-dessus des <dialog> et éléments plein écran quand c'est supporté.
    if (typeof host.showPopover === 'function') {
      try {
        host.popover = 'manual';
        host.showPopover();
      } catch (_) { /* ignore */ }
    }
    ctx = canvas.getContext('2d');
  }

  // ---------- événements ----------

  function schedule() {
    if (!rafId && state.enabled) rafId = requestAnimationFrame(draw);
  }

  function onScroll() {
    if (state.mode === 'hover' && mouse) pick();
    schedule();
  }

  function onResize() {
    metricsCache = new WeakMap();
    schedule();
  }

  function onMouseMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (state.mode === 'hover') pick();
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || !state.enabled) return;
    apply({ enabled: false });
    if (rt) rt.runtime.sendMessage({ type: 'ls:disabled' }).catch(() => {});
  }

  function onMutation(records) {
    if (records.every((r) => r.target === host)) return;
    metricsCache = new WeakMap();
    schedule();
  }

  function pick() {
    const el = document.elementFromPoint(mouse.x, mouse.y);
    const target = el && el !== host ? el : null;
    if (target !== hovered) {
      hovered = target;
      schedule();
    }
  }

  // ---------- mesures ----------

  function metrics(el) {
    let m = metricsCache.get(el);
    if (m) return m;
    const cs = getComputedStyle(el);
    const n = (p) => parseFloat(cs.getPropertyValue(p)) || 0;
    const sides = (pre, post = '') => ['top', 'right', 'bottom', 'left'].map((s) => n(`${pre}-${s}${post}`));
    m = {
      hidden: cs.display === 'none' || cs.visibility !== 'visible',
      margin: sides('margin'),
      border: sides('border', '-width'),
      padding: sides('padding'),
    };
    metricsCache.set(el, m);
    return m;
  }

  const expand = (b, [t, r, bo, l]) => ({ t: b.t - t, r: b.r + r, b: b.b + bo, l: b.l - l });

  function shrink(b, [t, r, bo, l]) {
    const nl = b.l + l;
    const nt = b.t + t;
    return { t: nt, r: Math.max(nl, b.r - r), b: Math.max(nt, b.b - bo), l: nl };
  }

  function measure(el) {
    const m = metrics(el);
    if (m.hidden) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const border = { t: rect.top, r: rect.right, b: rect.bottom, l: rect.left };
    const padding = shrink(border, m.border);
    return {
      el,
      m,
      rect,
      box: { margin: expand(border, m.margin), border, padding, content: shrink(padding, m.padding) },
    };
  }

  // Couche -> [boîte extérieure, boîte intérieure, valeurs par côté]
  function layerGeom(it, layer) {
    const { box, m } = it;
    if (layer === 'margin') return [box.margin, box.border, m.margin];
    if (layer === 'border') return [box.border, box.padding, m.border];
    return [box.padding, box.content, m.padding];
  }

  function collect() {
    const out = [];
    if (!document.body) return out;
    const margin = 200;
    const els = [document.body, ...document.body.getElementsByTagName('*')];
    for (const el of els) {
      if (out.length >= MAX_ELEMENTS) break;
      if (el === host || SKIP.has(el.localName)) continue;
      if (el instanceof SVGElement && el.localName !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom < -margin || r.top > viewport.h + margin || r.right < -margin || r.left > viewport.w + margin) continue;
      const it = measure(el);
      if (it) out.push(it);
    }
    return out;
  }

  // ---------- dessin ----------

  function draw() {
    rafId = 0;
    if (!state.enabled || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    viewport = { w, h };
    placed = [];
    if (state.mode === 'all') drawAll();
    else drawHover();
  }

  function drawHover() {
    if (hovered && !hovered.isConnected) hovered = null;
    const it = hovered && measure(hovered);
    if (!it) return;
    const alpha = ALPHA.hover;
    const { box } = it;

    if (state.layers.content) fillRect(box.content, `rgba(${COLORS.content.rgb},${alpha.content})`);
    for (const layer of LAYERS) {
      if (!state.layers[layer]) continue;
      const [outer, inner] = layerGeom(it, layer);
      drawRing(outer, inner, `rgba(${COLORS[layer].rgb},${alpha[layer]})`);
    }

    const outerMost = union(box.margin, box.border);
    const labels = [];
    for (const layer of LAYERS) {
      if (!state.layers[layer]) continue;
      const [outer, inner, values] = layerGeom(it, layer);
      sideLabels(labels, layer, outer, inner, values, {
        min: 0,
        force: true,
        distance: (side, ax, ay, thickness, lw) => {
          if (side === 0) return ay - outerMost.t + GAP + LABEL_H / 2;
          if (side === 2) return outerMost.b - ay + GAP + LABEL_H / 2;
          if (side === 3) return ax - outerMost.l + GAP + lw / 2;
          return outerMost.r - ax + GAP + lw / 2;
        },
      });
    }

    if (state.layers.content) {
      const c = box.content;
      const text = `${fmt(c.r - c.l)} × ${fmt(c.b - c.t)}`;
      const lw = labelWidth(text);
      if (c.r - c.l >= lw + 4 && c.b - c.t >= LABEL_H + 2) {
        const cx = (c.l + c.r) / 2;
        const cy = (c.t + c.b) / 2;
        const rect = { l: cx - lw / 2, t: cy - LABEL_H / 2, r: cx + lw / 2, b: cy + LABEL_H / 2 };
        placed.push(rect);
        labels.push({ rect, text, layer: 'content' });
      }
    }

    renderLabels(labels);
    drawTooltip(it, outerMost);
  }

  function drawAll() {
    const items = collect();
    const alpha = ALPHA.all;

    for (const layer of LAYERS) {
      if (!state.layers[layer]) continue;
      ctx.fillStyle = `rgba(${COLORS[layer].rgb},${alpha[layer]})`;
      for (const it of items) {
        const [outer, inner, values] = layerGeom(it, layer);
        if (values.some((v) => v > 0)) drawRing(outer, inner, null);
      }
    }

    if (state.layers.content) {
      ctx.strokeStyle = `rgba(${COLORS.content.rgb},${alpha.content})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      for (const { box: { content: c } } of items) {
        if (c.r - c.l >= 2 && c.b - c.t >= 2) ctx.rect(c.l + 0.5, c.t + 0.5, c.r - c.l - 1, c.b - c.t - 1);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const labels = [];
    for (const it of items) {
      for (const layer of LAYERS) {
        if (!state.layers[layer]) continue;
        const [outer, inner, values] = layerGeom(it, layer);
        sideLabels(labels, layer, outer, inner, values, {
          min: MIN_LABEL_ALL,
          force: false,
          distance: (side, ax, ay, thickness, lw) => {
            const vertical = side === 0 || side === 2;
            const size = vertical ? LABEL_H : lw;
            if (thickness >= size + 2) return 0; // tient dans la bande
            return thickness / 2 + GAP + size / 2;
          },
        });
      }
    }
    renderLabels(labels);
  }

  function sideLabels(labels, layer, outer, inner, values, opts) {
    const f = STAGGER[layer];
    for (let side = 0; side < 4; side++) {
      const v = values[side];
      if (v === 0 || Math.abs(v) < opts.min) continue;
      let ax, ay, x1, y1, x2, y2, dir;
      if (side === 0 || side === 2) {
        ax = inner.l + (inner.r - inner.l) * f;
        y1 = side === 0 ? outer.t : outer.b;
        y2 = side === 0 ? inner.t : inner.b;
        x1 = x2 = ax;
        ay = (y1 + y2) / 2;
        dir = side === 0 ? [0, -1] : [0, 1];
      } else {
        ay = inner.t + (inner.b - inner.t) * f;
        x1 = side === 3 ? outer.l : outer.r;
        x2 = side === 3 ? inner.l : inner.r;
        y1 = y2 = ay;
        ax = (x1 + x2) / 2;
        dir = side === 3 ? [-1, 0] : [1, 0];
      }
      if (ax < 0 || ay < 0 || ax > viewport.w || ay > viewport.h) continue;

      const text = fmt(v);
      const lw = labelWidth(text);
      const vertical = side === 0 || side === 2;
      const thickness = vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1);
      const base = opts.distance(side, ax, ay, thickness, lw);
      const step = (vertical ? LABEL_H : lw) + 3;

      let rect = null;
      for (let i = 0; i < 4; i++) {
        const d = base + i * step;
        const cx = clamp(ax + dir[0] * d, lw / 2 + 2, viewport.w - lw / 2 - 2);
        const cy = clamp(ay + dir[1] * d, LABEL_H / 2 + 2, viewport.h - LABEL_H / 2 - 2);
        const candidate = { l: cx - lw / 2, t: cy - LABEL_H / 2, r: cx + lw / 2, b: cy + LABEL_H / 2 };
        if (!placed.some((p) => overlaps(p, candidate))) {
          rect = candidate;
          break;
        }
        if (opts.force && i === 3) rect = candidate;
      }
      if (!rect) continue;
      placed.push(rect);
      labels.push({ rect, text, layer, ax, ay, x1, y1, x2, y2, thickness, vertical });
    }
  }

  function renderLabels(labels) {
    // 1. traits de cote (mesure de la bande) + traits de rappel vers l'étiquette
    ctx.lineWidth = 1;
    for (const l of labels) {
      if (l.ax === undefined) continue;
      const color = COLORS[l.layer].line;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (l.thickness >= 3) {
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        const t = 3;
        if (l.vertical) {
          ctx.moveTo(l.x1 - t, l.y1); ctx.lineTo(l.x1 + t, l.y1);
          ctx.moveTo(l.x2 - t, l.y2); ctx.lineTo(l.x2 + t, l.y2);
        } else {
          ctx.moveTo(l.x1, l.y1 - t); ctx.lineTo(l.x1, l.y1 + t);
          ctx.moveTo(l.x2, l.y2 - t); ctx.lineTo(l.x2, l.y2 + t);
        }
      }
      const tx = clamp(l.ax, l.rect.l, l.rect.r);
      const ty = clamp(l.ay, l.rect.t, l.rect.b);
      if (Math.hypot(tx - l.ax, ty - l.ay) > 1) {
        ctx.moveTo(l.ax, l.ay);
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(l.ax, l.ay, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 2. étiquettes par-dessus
    for (const l of labels) drawLabel(l);
  }

  function drawLabel({ rect, text, layer }) {
    const w = rect.r - rect.l;
    roundRect(rect.l, rect.t, w, LABEL_H, 3);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.fillStyle = `rgb(${COLORS[layer].rgb})`;
    ctx.fillRect(rect.l + 4, rect.t + 4, 3, LABEL_H - 8);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, rect.l + 11, rect.t + LABEL_H / 2 + 0.5);
  }

  function drawTooltip(it, outerMost) {
    const parts = selectorParts(it.el);
    const dims = `${fmt(it.rect.width)} × ${fmt(it.rect.height)}`;
    parts.push({ text: '  ' + dims, color: '#d4d4d4' });
    let tw = 0;
    for (const p of parts) tw += ctx.measureText(p.text).width;
    const w = Math.min(tw + 16, viewport.w - 8);
    const h = 22;
    let y = outerMost.b + GAP + LABEL_H + 8;
    if (y + h > viewport.h - 4) y = outerMost.t - GAP - LABEL_H - 8 - h;
    if (y < 4) y = clamp(outerMost.t + 4, 4, viewport.h - h - 4);
    const x = clamp(outerMost.l, 4, viewport.w - w - 4);

    roundRect(x, y, w, h, 4);
    ctx.fillStyle = 'rgba(17,17,17,0.95)';
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    let cx = x + 8;
    for (const p of parts) {
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, cx, y + h / 2 + 0.5);
      cx += ctx.measureText(p.text).width;
    }
    ctx.restore();
  }

  function selectorParts(el) {
    const parts = [{ text: el.localName, color: '#f28bd5' }];
    if (el.id) parts.push({ text: '#' + el.id, color: '#ffcf70' });
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    if (cls.length) {
      let s = '.' + cls.slice(0, 3).join('.');
      if (cls.length > 3) s += '…';
      parts.push({ text: s.length > 60 ? s.slice(0, 59) + '…' : s, color: '#8cc8ff' });
    }
    return parts;
  }

  // ---------- primitives ----------

  function drawRing(outer, inner, fill) {
    const o = union(outer, inner);
    ctx.beginPath();
    ctx.rect(o.l, o.t, o.r - o.l, o.b - o.t);
    ctx.rect(inner.l, inner.t, inner.r - inner.l, inner.b - inner.t);
    if (fill) ctx.fillStyle = fill;
    ctx.fill('evenodd');
  }

  function fillRect(b, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(b.l, b.t, b.r - b.l, b.b - b.t);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function labelWidth(text) {
    let w = widthCache.get(text);
    if (w === undefined) {
      ctx.font = FONT;
      w = Math.ceil(ctx.measureText(text).width) + 16;
      widthCache.set(text, w);
    }
    return w;
  }

  const union = (a, b) => ({
    t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b), l: Math.min(a.l, b.l),
  });
  const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const clamp = (v, min, max) => (max < min ? min : Math.min(max, Math.max(min, v)));
  const fmt = (v) => String(+v.toFixed(2));

  // ---------- API ----------

  window.__layoutShower = { set: apply, get: snapshot };

  if (rt) {
    rt.runtime.onMessage.addListener((msg) => {
      if (!msg) return undefined;
      if (msg.type === 'ls:ping') return Promise.resolve({ state: snapshot() });
      if (msg.type === 'ls:set') return Promise.resolve({ state: apply(msg.state) });
      return undefined;
    });
  }
})();
