// Layout Shower — moteur de rendu injecté dans la page.
// Dessine margin / border / padding / content sur un canvas plein écran isolé en Shadow DOM.
(() => {
  "use strict";
  if (window.__layoutShower) return;

  const LAYERS = ["margin", "border", "padding"];
  const COLORS = {
    margin: { rgb: "246,178,107", line: "#c9731f" },
    border: { rgb: "255,221,120", line: "#b08a12" },
    padding: { rgb: "147,196,125", line: "#4f8a35" },
    content: { rgb: "111,168,220", line: "#2f6fae" },
    flex: { rgb: "167,139,250", line: "#6d4bd1" },
    grid: { rgb: "236,72,153", line: "#be185d" },
    gap: { rgb: "20,184,166", line: "#0f766e" },
  };
  // Couleurs du texte dans l'infobulle (fond sombre).
  const TIP = {
    text: "#d4d4d4",
    flex: "#b9a4fb",
    grid: "#f58cc0",
    gap: "#5fd0c4",
  };
  // Élément épinglé (clic) : contour et infobulle distincts du survol.
  const PIN = { line: "#38bdf8", text: "#7dd3fc" };
  // Position relative des étiquettes le long d'un côté, pour que les couches ne se superposent pas.
  const STAGGER = { margin: 0.2, border: 0.5, padding: 0.8 };
  const ALPHA = {
    hover: { margin: 0.55, border: 0.7, padding: 0.55, content: 0.45 },
    all: { margin: 0.3, border: 0.5, padding: 0.3, content: 0.7 },
  };
  const MAX_ELEMENTS = 3000;
  const MIN_LABEL_ALL = 4;
  const MAX_CHILDREN = 300;
  const LABEL_H = 16;
  const GAP = 6;
  const FONT =
    "600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const SKIP = new Set([
    "script",
    "style",
    "link",
    "meta",
    "head",
    "title",
    "noscript",
    "template",
    "br",
    "wbr",
    "option",
    "source",
    "track",
    "param",
  ]);

  const state = {
    enabled: false,
    mode: "hover",
    layers: {
      margin: true,
      border: true,
      padding: true,
      content: true,
      flex: true,
      grid: true,
      gap: true,
    },
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
  let pinned = null;
  let observer = null;
  let placed = [];
  let gapPat = null;

  const rt =
    typeof browser !== "undefined" &&
    browser.runtime &&
    browser.runtime.onMessage
      ? browser
      : null;

  // ---------- état ----------

  const snapshot = () => ({
    enabled: state.enabled,
    mode: state.mode,
    layers: { ...state.layers },
  });

  function apply(next = {}) {
    const wasEnabled = state.enabled;
    if (next.mode === "hover" || next.mode === "all") state.mode = next.mode;
    if (next.layers) state.layers = { ...state.layers, ...next.layers };
    if (typeof next.enabled === "boolean") state.enabled = next.enabled;

    if (state.enabled && !wasEnabled) start();
    else if (!state.enabled && wasEnabled) stop();
    else if (state.enabled) schedule();
    return snapshot();
  }

  function start() {
    mount();
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("mousemove", onMouseMove, {
      capture: true,
      passive: true,
    });
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    schedule();
  }

  function stop() {
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMouseMove, { capture: true });
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    if (observer) observer.disconnect();
    observer = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (host) host.remove();
    host = canvas = ctx = null;
    gapPat = null;
    hovered = null;
    pinned = null;
    metricsCache = new WeakMap();
  }

  function mount() {
    host = document.createElement("div");
    host.setAttribute("data-layout-shower", "");
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "inset:0",
      "width:100%",
      "height:100%",
      "margin:0",
      "padding:0",
      "border:0",
      "background:transparent",
      "overflow:hidden",
      "pointer-events:none",
      "z-index:2147483647",
      "display:block",
    ]
      .map((d) => d + " !important")
      .join(";");
    const root = host.attachShadow({ mode: "closed" });
    canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    root.appendChild(canvas);
    document.documentElement.appendChild(host);
    // Top layer : passe au-dessus des <dialog> et éléments plein écran quand c'est supporté.
    if (typeof host.showPopover === "function") {
      try {
        host.popover = "manual";
        host.showPopover();
      } catch (_) {
        /* ignore */
      }
    }
    ctx = canvas.getContext("2d");
  }

  // ---------- événements ----------

  function schedule() {
    if (!rafId && state.enabled) rafId = requestAnimationFrame(draw);
  }

  function onScroll() {
    if (state.mode === "hover" && mouse) pick();
    schedule();
  }

  function onResize() {
    metricsCache = new WeakMap();
    schedule();
  }

  function onMouseMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (state.mode === "hover") pick();
  }

  // Clic en mode Survol : épingle l'élément (re-clic dessus = on le détache).
  // Le clic n'est pas bloqué : la page réagit normalement.
  function onClick(e) {
    if (state.mode !== "hover" || !e.isTrusted) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = el && el !== host ? el : null;
    pinned = target && target !== pinned ? target : null;
    schedule();
  }

  function onKeyDown(e) {
    if (e.key !== "Escape" || !state.enabled) return;
    // Premier Échap : détache l'élément épinglé ; le suivant désactive.
    if (pinned) {
      pinned = null;
      schedule();
      return;
    }
    apply({ enabled: false });
    if (rt) rt.runtime.sendMessage({ type: "ls:disabled" }).catch(() => {});
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
    const sides = (pre, post = "") =>
      ["top", "right", "bottom", "left"].map((s) => n(`${pre}-${s}${post}`));
    const d = cs.display;
    m = {
      hidden: d === "none" || cs.visibility !== "visible",
      display: d,
      position: cs.position,
      margin: sides("margin"),
      border: sides("border", "-width"),
      padding: sides("padding"),
      rowGap: cs.rowGap,
      colGap: cs.columnGap,
      flex:
        d === "flex" || d === "inline-flex"
          ? {
              dir: cs.flexDirection,
              wrap: cs.flexWrap,
              justify: cs.justifyContent,
              align: cs.alignItems,
              rtl: cs.direction === "rtl",
            }
          : null,
      grid:
        d === "grid" || d === "inline-grid"
          ? { cols: cs.gridTemplateColumns, rows: cs.gridTemplateRows }
          : null,
    };
    metricsCache.set(el, m);
    return m;
  }

  const expand = (b, [t, r, bo, l]) => ({
    t: b.t - t,
    r: b.r + r,
    b: b.b + bo,
    l: b.l - l,
  });

  function shrink(b, [t, r, bo, l]) {
    const nl = b.l + l;
    const nt = b.t + t;
    return {
      t: nt,
      r: Math.max(nl, b.r - r),
      b: Math.max(nt, b.b - bo),
      l: nl,
    };
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
      box: {
        margin: expand(border, m.margin),
        border,
        padding,
        content: shrink(padding, m.padding),
      },
    };
  }

  // Couche -> [boîte extérieure, boîte intérieure, valeurs par côté]
  function layerGeom(it, layer) {
    const { box, m } = it;
    if (layer === "margin") return [box.margin, box.border, m.margin];
    if (layer === "border") return [box.border, box.padding, m.border];
    return [box.padding, box.content, m.padding];
  }

  function collect() {
    const out = [];
    if (!document.body) return out;
    const margin = 200;
    const els = [document.body, ...document.body.getElementsByTagName("*")];
    for (const el of els) {
      if (out.length >= MAX_ELEMENTS) break;
      if (el === host || SKIP.has(el.localName)) continue;
      if (el instanceof SVGElement && el.localName !== "svg") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (
        r.bottom < -margin ||
        r.top > viewport.h + margin ||
        r.right < -margin ||
        r.left > viewport.w + margin
      )
        continue;
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
    ctx.textBaseline = "middle";
    viewport = { w, h };
    placed = [];
    if (state.mode === "all") drawAll();
    else drawHover();
  }

  // Tant qu'un élément est épinglé, il remplace le survol : on ne dessine que lui.
  function drawHover() {
    if (hovered && !hovered.isConnected) hovered = null;
    if (pinned && !pinned.isConnected) pinned = null;
    if (pinned) drawElement(pinned, true);
    else if (hovered) drawElement(hovered, false);
  }

  function drawElement(el, isPinned) {
    const it = measure(el);
    if (!it) return;
    const alpha = ALPHA.hover;
    const { box } = it;

    if (state.layers.content)
      fillRect(box.content, `rgba(${COLORS.content.rgb},${alpha.content})`);
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
        const rect = {
          l: cx - lw / 2,
          t: cy - LABEL_H / 2,
          r: cx + lw / 2,
          b: cy + LABEL_H / 2,
        };
        placed.push(rect);
        labels.push({ rect, text, layer: "content" });
      }
    }

    const info = drawLayout(it, labels, true);
    renderLabels(labels);
    if (isPinned) drawPinOutline(outerMost);
    drawTooltip(it, outerMost, info, isPinned);
  }

  // Contour pointillé blanc/bleu autour de l'élément épinglé : le distingue du simple survol.
  function drawPinOutline(b) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = PIN.line;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.l - 1, b.t - 1, b.r - b.l + 2, b.b - b.t + 2);
    ctx.restore();
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
      for (const {
        box: { content: c },
      } of items) {
        if (c.r - c.l >= 2 && c.b - c.t >= 2)
          ctx.rect(c.l + 0.5, c.t + 0.5, c.r - c.l - 1, c.b - c.t - 1);
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
    for (const it of items) {
      if (it.m.flex || it.m.grid) drawLayout(it, labels, false);
    }
    renderLabels(labels);
  }

  // ---------- flex / grid / gap ----------

  const gapPx = (raw, base) => {
    const v = parseFloat(raw);
    if (!v) return 0; // "normal", NaN, 0
    return String(raw).endsWith("%") ? (v * base) / 100 : v;
  };

  function drawLayout(it, labels, detail) {
    const { flex, grid } = it.m;
    const on = state.layers;
    let gaps = [];
    if (flex) {
      const kids = on.gap || (on.flex && detail) ? flowChildren(it.el) : [];
      if (on.flex) drawFlex(it, kids, labels, detail);
      if (on.gap) gaps = flexGaps(it, kids);
    } else if (grid) {
      const g = gridTracks(it);
      if (g && on.grid) drawGrid(g, labels, detail);
      if (g && on.gap) gaps = gridGaps(g);
    }
    drawGaps(gaps, labels, detail);
    return detail ? infoLines(it) : [];
  }

  // Enfants qui participent au layout (ni display:none, ni positionnés hors flux).
  function flowChildren(el) {
    const out = [];
    for (const ch of el.children) {
      if (out.length >= MAX_CHILDREN) break;
      if (ch === host) continue;
      const m = metrics(ch);
      if (m.display === "none") continue;
      if (m.position === "absolute" || m.position === "fixed") continue;
      const r = ch.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const border = { t: r.top, r: r.right, b: r.bottom, l: r.left };
      out.push({ border, margin: expand(border, m.margin) });
    }
    return out;
  }

  function flexAxis(f) {
    const horizontal = f.dir.startsWith("row");
    const reverse = f.dir.endsWith("reverse") !== (horizontal && f.rtl);
    return { horizontal, reverse };
  }

  function drawFlex(it, kids, labels, detail) {
    const f = it.m.flex;
    const c = it.box.content;
    const w = c.r - c.l;
    const h = c.b - c.t;
    const { horizontal, reverse } = flexAxis(f);
    ctx.save();
    if (detail) {
      ctx.strokeStyle = `rgba(${COLORS.flex.rgb},0.95)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      if (w >= 2 && h >= 2) ctx.strokeRect(c.l + 0.5, c.t + 0.5, w - 1, h - 1);
      for (const { border: b } of kids)
        ctx.strokeRect(b.l + 0.5, b.t + 0.5, b.r - b.l - 1, b.b - b.t - 1);
      ctx.setLineDash([]);
    }
    // Flèche = sens de l'axe principal, le long du bord bas (ou droit en colonne).
    const len = horizontal ? w : h;
    const cross = horizontal ? h : w;
    if (len >= 40 && cross >= 12) {
      const L = Math.min(len - 16, 60);
      const sgn = reverse ? -1 : 1;
      const dx = horizontal ? sgn : 0;
      const dy = horizontal ? 0 : sgn;
      const sx = horizontal ? (reverse ? c.r - 8 : c.l + 8) : c.r - 8;
      const sy = horizontal ? c.b - 8 : reverse ? c.b - 8 : c.t + 8;
      const ex = sx + dx * L;
      const ey = sy + dy * L;
      ctx.strokeStyle = COLORS.flex.line;
      ctx.fillStyle = COLORS.flex.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + dx * 5, ey + dy * 5);
      ctx.lineTo(ex - dx * 3 + dy * 5, ey - dy * 3 + dx * 5);
      ctx.lineTo(ex - dx * 3 - dy * 5, ey - dy * 3 - dx * 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const text = `flex ${f.dir}${f.wrap !== "nowrap" ? " " + f.wrap : ""}`;
    badge(labels, "flex", text, c, detail);
  }

  function badge(labels, layer, text, c, detail) {
    const lw = labelWidth(text);
    if (!detail && (c.r - c.l < lw + 4 || c.b - c.t < LABEL_H + 2)) return;
    pushLabel(labels, layer, text, c.r - lw / 2 - 2, c.t + LABEL_H / 2 + 2, detail);
  }

  // Place une étiquette sans connecteur ; en détail on décale vers le bas si besoin.
  function pushLabel(labels, layer, text, cx, cy, detail, steps) {
    const lw = labelWidth(text);
    if (cx < 0 || cy < 0 || cx > viewport.w || cy > viewport.h) return;
    const n = steps || (detail ? 4 : 1);
    const force = detail && !steps;
    let rect = null;
    let free = false;
    for (let i = 0; i < n && !free; i++) {
      const x = clamp(cx, lw / 2 + 2, viewport.w - lw / 2 - 2);
      const y = clamp(
        cy + i * (LABEL_H + 3),
        LABEL_H / 2 + 2,
        viewport.h - LABEL_H / 2 - 2,
      );
      rect = { l: x - lw / 2, t: y - LABEL_H / 2, r: x + lw / 2, b: y + LABEL_H / 2 };
      free = !placed.some((p) => overlaps(p, rect));
    }
    if (!free && !force) return;
    placed.push(rect);
    labels.push({ rect, text, layer });
  }

  // Gaps d'un conteneur flex : entre éléments d'une ligne (axe principal) et entre lignes.
  function flexGaps(it, kids) {
    const f = it.m.flex;
    const c = it.box.content;
    const { horizontal } = flexAxis(f);
    const colGap = gapPx(it.m.colGap, c.r - c.l);
    const rowGap = gapPx(it.m.rowGap, c.b - c.t);
    const mainGap = horizontal ? colGap : rowGap;
    const crossGap = horizontal ? rowGap : colGap;
    if (!mainGap && !crossGap) return [];

    const ext = (b) =>
      horizontal
        ? { ms: b.l, me: b.r, cs: b.t, ce: b.b }
        : { ms: b.t, me: b.b, cs: b.l, ce: b.r };
    const mk = (ms, me, cs, ce, size) => ({
      ...(horizontal
        ? { l: ms, r: me, t: cs, b: ce }
        : { l: cs, r: ce, t: ms, b: me }),
      size,
    });

    const items = kids.map((k) => ext(k.margin)).sort((a, b) => a.cs - b.cs);
    const lines = [];
    for (const i of items) {
      const last = lines[lines.length - 1];
      if (last && i.cs < last.ce - 0.5) {
        last.items.push(i);
        last.ce = Math.max(last.ce, i.ce);
      } else lines.push({ cs: i.cs, ce: i.ce, items: [i] });
    }

    const out = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.ms - b.ms);
      line.ms = line.items[0].ms;
      line.me = line.items[0].me;
      for (let k = 1; k < line.items.length; k++) {
        const n = line.items[k];
        if (mainGap && n.ms - line.me >= mainGap - 0.5)
          out.push(mk(line.me, line.me + mainGap, line.cs, line.ce, mainGap));
        line.me = Math.max(line.me, n.me);
      }
    }
    if (crossGap) {
      for (let k = 1; k < lines.length; k++) {
        const a = lines[k - 1];
        const b = lines[k];
        if (b.cs - a.ce >= crossGap - 0.5)
          out.push(
            mk(
              Math.min(a.ms, b.ms),
              Math.max(a.me, b.me),
              a.ce,
              a.ce + crossGap,
              crossGap,
            ),
          );
      }
    }
    return out;
  }

  // ----- grid -----

  function parseTracks(v) {
    if (!v || v === "none") return [];
    const out = [];
    for (const tok of v.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/)) {
      if (!tok) continue;
      const n = parseFloat(tok);
      if (!tok.endsWith("px") || isNaN(n)) return []; // subgrid, masonry…
      out.push(n);
    }
    return out;
  }

  // Pistes en coordonnées viewport : API Firefox getGridFragments(), sinon valeurs calculées.
  function gridTracks(it) {
    if (it.gridTracks !== undefined) return it.gridTracks;
    const c = it.box.content;
    let res = null;
    try {
      const frags =
        typeof it.el.getGridFragments === "function"
          ? it.el.getGridFragments()
          : null;
      if (frags && frags.length) {
        const f = frags[0];
        const conv = (dim, origin) =>
          Array.from(dim.tracks, (t) => ({
            s: origin + t.start,
            e: origin + t.start + t.breadth,
          }));
        res = { cols: conv(f.cols, c.l), rows: conv(f.rows, c.t) };
      }
    } catch (_) {
      res = null;
    }
    if (!res || !res.cols.length || !res.rows.length) {
      const place = (sizes, origin, gap) => {
        let p = origin;
        return sizes.map((s) => {
          const t = { s: p, e: p + s };
          p += s + gap;
          return t;
        });
      };
      const cols = parseTracks(it.m.grid.cols);
      const rows = parseTracks(it.m.grid.rows);
      res =
        cols.length && rows.length
          ? {
              cols: place(cols, c.l, gapPx(it.m.colGap, c.r - c.l)),
              rows: place(rows, c.t, gapPx(it.m.rowGap, c.b - c.t)),
            }
          : null;
    }
    it.gridTracks = res;
    return res;
  }

  function drawGrid(g, labels, detail) {
    const L = g.cols[0].s;
    const R = g.cols[g.cols.length - 1].e;
    const T = g.rows[0].s;
    const B = g.rows[g.rows.length - 1].e;
    ctx.save();
    ctx.strokeStyle = `rgba(${COLORS.grid.rgb},0.95)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const x of new Set(g.cols.flatMap((t) => [t.s, t.e]))) {
      ctx.moveTo(x, T);
      ctx.lineTo(x, B);
    }
    for (const y of new Set(g.rows.flatMap((t) => [t.s, t.e]))) {
      ctx.moveTo(L, y);
      ctx.lineTo(R, y);
    }
    ctx.stroke();
    ctx.restore();

    if (detail) {
      for (const t of g.cols)
        pushLabel(labels, "grid", fmt(t.e - t.s), (t.s + t.e) / 2, T + LABEL_H / 2 + 1, true, 1);
      for (const t of g.rows) {
        const text = fmt(t.e - t.s);
        pushLabel(labels, "grid", text, L + labelWidth(text) / 2 + 1, (t.s + t.e) / 2, true, 1);
      }
    }
    const text = `grid ${g.cols.length}×${g.rows.length}`;
    badge(labels, "grid", text, { l: L, r: R, t: T, b: B }, detail);
  }

  function gridGaps(g) {
    const out = [];
    const L = g.cols[0].s;
    const R = g.cols[g.cols.length - 1].e;
    const T = g.rows[0].s;
    const B = g.rows[g.rows.length - 1].e;
    for (let i = 1; i < g.cols.length; i++) {
      const size = g.cols[i].s - g.cols[i - 1].e;
      if (size >= 0.5)
        out.push({ l: g.cols[i - 1].e, r: g.cols[i].s, t: T, b: B, size });
    }
    for (let i = 1; i < g.rows.length; i++) {
      const size = g.rows[i].s - g.rows[i - 1].e;
      if (size >= 0.5)
        out.push({ l: L, r: R, t: g.rows[i - 1].e, b: g.rows[i].s, size });
    }
    return out;
  }

  // ----- gaps (communs flex / grid) -----

  function gapPattern() {
    if (gapPat) return gapPat;
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d");
    g.fillStyle = `rgba(${COLORS.gap.rgb},0.22)`;
    g.fillRect(0, 0, 8, 8);
    g.strokeStyle = `rgba(${COLORS.gap.rgb},0.9)`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(8, 0);
    g.moveTo(-1, 1);
    g.lineTo(1, -1);
    g.moveTo(7, 9);
    g.lineTo(9, 7);
    g.stroke();
    gapPat = ctx.createPattern(c, "repeat");
    return gapPat;
  }

  function drawGaps(gaps, labels, detail) {
    if (!gaps.length) return;
    ctx.fillStyle = gapPattern();
    for (const r of gaps) ctx.fillRect(r.l, r.t, r.r - r.l, r.b - r.t);
    for (const r of gaps) {
      if (!detail && r.size < MIN_LABEL_ALL) continue;
      pushLabel(labels, "gap", fmt(r.size), (r.l + r.r) / 2, (r.t + r.b) / 2, detail);
    }
  }

  // Lignes d'info de l'infobulle (survol) : direction, wrap, justify/align, gap…
  function infoLines(it) {
    const on = state.layers;
    const { flex: f, grid } = it.m;
    const c = it.box.content;
    const T = (text, color = TIP.text) => ({ text, color });
    const lines = [];
    if (f && on.flex)
      lines.push([
        T("flex ", TIP.flex),
        T(`${f.dir} · ${f.wrap} · justify ${f.justify} · align ${f.align}`),
      ]);
    if (grid && on.grid) {
      const g = gridTracks(it);
      lines.push([
        T("grid ", TIP.grid),
        T(g ? `${g.cols.length} col × ${g.rows.length} row` : "pistes non résolues"),
      ]);
    }
    if ((f || grid) && on.gap) {
      const r = gapPx(it.m.rowGap, c.b - c.t);
      const cg = gapPx(it.m.colGap, c.r - c.l);
      if (r || cg)
        lines.push([
          T("gap ", TIP.gap),
          T(r === cg ? `${fmt(r)}` : `row ${fmt(r)} · col ${fmt(cg)}`),
        ]);
    }
    const p = it.el.parentElement;
    if (on.flex && p && metrics(p).flex && it.m.position !== "absolute" && it.m.position !== "fixed") {
      const cs = getComputedStyle(it.el);
      lines.push([
        T("item ", TIP.flex),
        T(`grow ${cs.flexGrow} · shrink ${cs.flexShrink} · basis ${cs.flexBasis}`),
      ]);
    }
    return lines;
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
        const cy = clamp(
          ay + dir[1] * d,
          LABEL_H / 2 + 2,
          viewport.h - LABEL_H / 2 - 2,
        );
        const candidate = {
          l: cx - lw / 2,
          t: cy - LABEL_H / 2,
          r: cx + lw / 2,
          b: cy + LABEL_H / 2,
        };
        if (!placed.some((p) => overlaps(p, candidate))) {
          rect = candidate;
          break;
        }
        if (opts.force && i === 3) rect = candidate;
      }
      if (!rect) continue;
      placed.push(rect);
      labels.push({
        rect,
        text,
        layer,
        ax,
        ay,
        x1,
        y1,
        x2,
        y2,
        thickness,
        vertical,
      });
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
          ctx.moveTo(l.x1 - t, l.y1);
          ctx.lineTo(l.x1 + t, l.y1);
          ctx.moveTo(l.x2 - t, l.y2);
          ctx.lineTo(l.x2 + t, l.y2);
        } else {
          ctx.moveTo(l.x1, l.y1 - t);
          ctx.lineTo(l.x1, l.y1 + t);
          ctx.moveTo(l.x2, l.y2 - t);
          ctx.lineTo(l.x2, l.y2 + t);
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
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.fillStyle = `rgb(${COLORS[layer].rgb})`;
    ctx.fillRect(rect.l + 4, rect.t + 4, 3, LABEL_H - 8);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, rect.l + 11, rect.t + LABEL_H / 2 + 0.5);
  }

  function drawTooltip(it, outerMost, extra = [], isPinned = false) {
    const first = selectorParts(it.el);
    if (isPinned) first.unshift({ text: "📌 ", color: PIN.text });
    first.push({
      text: `  ${fmt(it.rect.width)} × ${fmt(it.rect.height)}`,
      color: TIP.text,
    });
    const lines = [first, ...extra];
    ctx.font = FONT;
    let tw = 0;
    for (const parts of lines) {
      let lw = 0;
      for (const p of parts) lw += ctx.measureText(p.text).width;
      tw = Math.max(tw, lw);
    }
    const rowH = 16;
    const w = Math.min(tw + 16, viewport.w - 8);
    const h = 6 + rowH * lines.length;
    let y = outerMost.b + GAP + LABEL_H + 8;
    if (y + h > viewport.h - 4) y = outerMost.t - GAP - LABEL_H - 8 - h;
    if (y < 4) y = clamp(outerMost.t + 4, 4, viewport.h - h - 4);
    const x = clamp(outerMost.l, 4, viewport.w - w - 4);

    roundRect(x, y, w, h, 4);
    ctx.fillStyle = "rgba(17,17,17,0.95)";
    ctx.fill();
    if (isPinned) {
      ctx.strokeStyle = PIN.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    lines.forEach((parts, i) => {
      let cx = x + 8;
      const cy = y + 3 + rowH * (i + 0.5) + 0.5;
      for (const p of parts) {
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, cx, cy);
        cx += ctx.measureText(p.text).width;
      }
    });
    ctx.restore();
  }

  function selectorParts(el) {
    const parts = [{ text: el.localName, color: "#f28bd5" }];
    if (el.id) parts.push({ text: "#" + el.id, color: "#ffcf70" });
    const cls =
      typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    if (cls.length) {
      let s = "." + cls.slice(0, 3).join(".");
      if (cls.length > 3) s += "…";
      parts.push({
        text: s.length > 60 ? s.slice(0, 59) + "…" : s,
        color: "#8cc8ff",
      });
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
    ctx.fill("evenodd");
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
    t: Math.min(a.t, b.t),
    r: Math.max(a.r, b.r),
    b: Math.max(a.b, b.b),
    l: Math.min(a.l, b.l),
  });
  const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const clamp = (v, min, max) =>
    max < min ? min : Math.min(max, Math.max(min, v));
  const fmt = (v) => String(+v.toFixed(2));

  // ---------- API ----------

  window.__layoutShower = { set: apply, get: snapshot };

  if (rt) {
    rt.runtime.onMessage.addListener((msg) => {
      if (!msg) return undefined;
      if (msg.type === "ls:ping") return Promise.resolve({ state: snapshot() });
      if (msg.type === "ls:set")
        return Promise.resolve({ state: apply(msg.state) });
      return undefined;
    });
  }
})();
