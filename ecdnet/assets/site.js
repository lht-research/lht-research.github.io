(() => {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  /* ---------- Closed-loop explorer ---------- */
  function initExplorer() {
    const D = window.ECDNET_LOOP;
    if (!D) return;
    const N = 64;
    const lut = new Uint8Array(768);
    for (let i = 0; i < 768; i++) lut[i] = parseInt(D.lut.substr(i * 2, 2), 16);

    const cvTruth = document.querySelector('[data-panel="truth"] canvas');
    const cvEst = document.querySelector('[data-panel="estimate"] canvas');
    const valTruth = document.getElementById("val-truth");
    const valEst = document.getElementById("val-estimate");
    const count = document.getElementById("count");
    const scrub = document.getElementById("scrub");
    const replay = document.getElementById("replay");
    const bandChips = document.getElementById("band-chips");
    const sceneChips = document.getElementById("scene-chips");
    const spark = document.getElementById("spark");
    const cbar = document.querySelector(".cbar");

    let si = 0;                       // default scene: the first one
    let scene = D.scenes[si];
    let band = scene.active[1] ? 1 : scene.active.findIndex((v) => v); // 3.5 GHz when active
    let t = scene.total;
    let anim = null;
    const cache = new Map();          // key -> array of 64x64 canvases

    function loadGray(uri) {
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const x = c.getContext("2d");
          x.drawImage(img, 0, 0);
          res(x.getImageData(0, 0, img.width, img.height));
        };
        img.src = uri;
      });
    }
    function colorize(gray, offsetRow) {
      const c = document.createElement("canvas");
      c.width = N; c.height = N;
      const x = c.getContext("2d");
      const out = x.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const q = gray.data[(offsetRow * N + i) * 4];
        out.data[i * 4] = lut[q * 3]; out.data[i * 4 + 1] = lut[q * 3 + 1]; out.data[i * 4 + 2] = lut[q * 3 + 2]; out.data[i * 4 + 3] = 255;
      }
      x.putImageData(out, 0, 0);
      return c;
    }
    async function maps(s, b) {
      const key = s + ":" + b;
      if (cache.has(key)) return cache.get(key);
      const sc = D.scenes[s];
      const [gt, fr] = await Promise.all([loadGray(sc.truth[b]), loadGray(sc.frames[b])]);
      const entry = { truth: colorize(gt, 0), frames: D.steps.map((_, k) => colorize(fr, k * N)) };
      cache.set(key, entry);
      return entry;
    }

    // chips
    D.bands.forEach((name, b) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "chip"; el.textContent = name; el.dataset.band = b;
      el.addEventListener("click", () => { if (!el.disabled) { band = b; syncChips(); draw(); } });
      bandChips.appendChild(el);
    });
    D.scenes.forEach((sc, s) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "chip"; el.textContent = sc.name;
      el.addEventListener("click", () => {
        si = s; scene = sc;
        if (!scene.active[band]) band = scene.active.findIndex((v) => v);
        syncChips(); buildSpark(); play();
      });
      sceneChips.appendChild(el);
    });
    function syncChips() {
      bandChips.querySelectorAll(".chip").forEach((el) => {
        const b = +el.dataset.band;
        el.disabled = !scene.active[b];
        el.title = el.disabled ? "No transmitter is active in this band in the selected scene" : "";
        el.setAttribute("aria-pressed", b === band ? "true" : "false");
      });
      sceneChips.querySelectorAll(".chip").forEach((el, s) => el.setAttribute("aria-pressed", s === si ? "true" : "false"));
    }

    // geometry helpers (y = 0 is the bottom row)
    const cell = (p, s) => [(p[0] + 0.5) * s, (N - 1 - p[1] + 0.5) * s];
    function sizeCanvas(cv) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cv.clientWidth * dpr);
      if (cv.width !== w || cv.height !== w) { cv.width = w; cv.height = w; }
      return w;
    }
    function obstacles(ctx, s) {
      ctx.save();
      ctx.lineWidth = Math.max(1.2, s * 0.24); ctx.strokeStyle = "#14172a";
      scene.obstacles.forEach(([x0, y0, x1, y1]) => {
        const lw = ctx.lineWidth;
        ctx.strokeRect(x0 * s + lw / 2, (N - y1) * s + lw / 2, (x1 - x0) * s - lw, (y1 - y0) * s - lw);
      });
      ctx.restore();
    }
    function route(ctx, s, upto) {
      const pts = scene.route, n = Math.max(0, Math.min(pts.length - 1, Math.floor(upto)));
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = Math.max(1.4, s * 0.22);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const [x, y] = cell(pts[i], s); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      const f = upto - Math.floor(upto);
      let [ux, uy] = cell(pts[n], s);
      if (f > 0 && n + 1 < pts.length) { const [x1, y1] = cell(pts[n + 1], s); ux += (x1 - ux) * f; uy += (y1 - uy) * f; ctx.lineTo(ux, uy); }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(ux, uy, Math.max(9, s * 1.6), 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill();
      ctx.beginPath(); ctx.arc(ux, uy, Math.max(4.5, s * 0.8), 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = Math.max(1.2, s * 0.16); ctx.strokeStyle = "#14172a"; ctx.stroke();
      ctx.restore();
    }
    function stars(ctx, s) {
      ctx.save();
      scene.tx.forEach((tx) => {
        if (!tx.b[band]) return;
        const [cx, cy] = cell([tx.x, tx.y], s), R = Math.max(8, s * 1.7);
        ctx.beginPath();
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
        ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill();
        ctx.lineWidth = Math.max(1.2, s * 0.18); ctx.strokeStyle = "#14172a"; ctx.stroke();
      });
      ctx.restore();
    }
    function frameAt(tt) {
      const st = D.steps;
      let k = 0;
      while (k + 1 < st.length && st[k + 1] <= tt) k++;
      const k2 = Math.min(st.length - 1, k + 1);
      const a = k2 === k ? 0 : Math.min(1, Math.max(0, (tt - st[k]) / (st[k2] - st[k])));
      return { k, k2, a };
    }

    let token = 0;
    async function draw() {
      const my = ++token;
      const m = await maps(si, band);
      if (my !== token) return;
      const { k, k2, a } = frameAt(t);
      // ground truth
      let w = sizeCanvas(cvTruth), s = w / N, ctx = cvTruth.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(m.truth, 0, 0, w, w); obstacles(ctx, s); route(ctx, s, t); stars(ctx, s);
      // estimate
      w = sizeCanvas(cvEst); s = w / N; ctx = cvEst.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1; ctx.drawImage(m.frames[k], 0, 0, w, w);
      if (a > 0) { ctx.globalAlpha = a; ctx.drawImage(m.frames[k2], 0, 0, w, w); ctx.globalAlpha = 1; }
      obstacles(ctx, s); route(ctx, s, t);
      // text
      const rb = scene.rmse.band[band][a > 0.5 ? k2 : k], ra = scene.rmse.all[a > 0.5 ? k2 : k];
      valTruth.textContent = D.bands[band];
      if (D.showValues === false) valEst.textContent = D.bands[band];
      else valEst.innerHTML = (rb == null ? "" : `<strong>RMSE ${rb.toFixed(2)} dBm</strong> at ${D.bands[band]}<br>`) + `${ra.toFixed(2)} dBm over all bands`;
      count.innerHTML = `Step <strong>${Math.floor(t)}</strong> of ${scene.total}`;
      scrub.max = scene.total; scrub.value = Math.floor(t);
      moveSpark();
      if (cbar) cbar.style.setProperty("--cbar-h", cvTruth.clientHeight + "px");
    }

    // RMSE sparkline under the slider
    let sparkDot = null, sparkLine = null, sparkGeom = null;
    function buildSpark() {
      spark.textContent = "";
      const W = Math.max(200, spark.clientWidth), H = 46;
      const vals = scene.rmse.all, st = D.steps;
      const hi = Math.max(...vals), lo = Math.min(...vals);
      const pad = (hi - lo) * 0.12 || 1;
      const xs = (v) => (v / scene.total) * W, ys = (v) => 4 + (H - 8) * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
      const p = document.createElementNS(NS, "polyline");
      p.setAttribute("points", vals.map((v, i) => `${xs(st[i])},${ys(v)}`).join(" "));
      p.setAttribute("fill", "none"); p.setAttribute("stroke", "rgba(238,240,246,0.75)"); p.setAttribute("stroke-width", "1.6"); p.setAttribute("stroke-linejoin", "round");
      svg.appendChild(p);
      sparkLine = document.createElementNS(NS, "line");
      sparkLine.setAttribute("y1", 0); sparkLine.setAttribute("y2", H); sparkLine.setAttribute("stroke", "rgba(238,240,246,0.35)");
      svg.appendChild(sparkLine);
      sparkDot = document.createElementNS(NS, "circle");
      sparkDot.setAttribute("r", 4); sparkDot.setAttribute("fill", "#fff"); sparkDot.setAttribute("stroke", "#14172a"); sparkDot.setAttribute("stroke-width", 1.5);
      svg.appendChild(sparkDot);
      spark.appendChild(svg);
      sparkGeom = { xs, ys };
      moveSpark();
    }
    function moveSpark() {
      if (!sparkGeom) return;
      const { k, k2, a } = frameAt(t);
      const v = scene.rmse.all[k] * (1 - a) + scene.rmse.all[k2] * a;
      const x = sparkGeom.xs(t), y = sparkGeom.ys(v);
      sparkDot.setAttribute("cx", x); sparkDot.setAttribute("cy", y);
      sparkLine.setAttribute("x1", x); sparkLine.setAttribute("x2", x);
    }

    function stop() { if (anim) { cancelAnimationFrame(anim); anim = null; } }
    function play() {
      stop();
      if (reduceMotion) { t = scene.total; draw(); return; }
      const rate = 26; // steps per second
      const start = performance.now();
      const step = (now) => {
        t = Math.max(0, Math.min(scene.total, (now - start) / 1000 * rate));
        draw();
        if (t < scene.total) anim = requestAnimationFrame(step); else anim = null;
      };
      t = 0; draw();
      anim = requestAnimationFrame(step);
    }

    scrub.addEventListener("input", () => { stop(); t = +scrub.value; draw(); });
    replay.addEventListener("click", play);
    new ResizeObserver(() => { buildSpark(); draw(); }).observe(cvTruth);
    syncChips(); buildSpark(); draw();
    if (!reduceMotion) setTimeout(play, 600);
  }

  /* ---------- Chart helpers ---------- */
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, s, attrs) { const t = el("text", Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; }
  function makeTip(host) {
    const tip = document.createElement("div");
    tip.className = "tip"; tip.setAttribute("aria-hidden", "true");
    host.appendChild(tip);
    return {
      show(head, rows, x, y) {
        tip.textContent = "";
        const h = document.createElement("div"); h.className = "tip-head"; h.textContent = head; tip.appendChild(h);
        rows.forEach(([color, label, value]) => {
          const r = document.createElement("div"); r.className = "row";
          const k = document.createElement("span"); k.className = "k"; k.style.background = color || "transparent";
          const l = document.createElement("span"); l.textContent = label;
          const v = document.createElement("b"); v.textContent = value;
          r.append(k, l, v); tip.appendChild(r);
        });
        const pw = host.clientWidth, tw = tip.offsetWidth || 240;
        tip.style.left = Math.max(0, Math.min(pw - tw, x + 14)) + "px";
        tip.style.top = Math.max(0, y - 10) + "px";
        tip.classList.add("on");
      },
      hide() { tip.classList.remove("on"); },
    };
  }

  /* ---------- Chart: accuracy against readings ---------- */
  function chartRates(C) {
    const fig = document.getElementById("chart-rates");
    if (!fig) return;
    const plot = fig.querySelector(".plot");
    const R = C.rates;
    const color = { ecdnet: css("--ecd"), unet: css("--grey-1"), kgnet: css("--grey-2"), ae3d: css("--grey-3"), kriging: css("--grey-4") };
    const dash = { ecdnet: "", unet: "", kgnet: "6 4", ae3d: "2 3", kriging: "8 3 2 3" };
    const ul = document.getElementById("legend-rates");
    R.methods.forEach((m) => {
      const li = document.createElement("li");
      const svg = el("svg", { width: 22, height: 8, "aria-hidden": "true" });
      el("line", { x1: 1, x2: 21, y1: 4, y2: 4, stroke: color[m.id], "stroke-width": m.id === "ecdnet" ? 2.6 : 2, "stroke-dasharray": dash[m.id], "stroke-linecap": "round" }, svg);
      li.appendChild(svg); li.appendChild(document.createTextNode(m.name));
      ul.appendChild(li);
    });
    const tip = makeTip(plot);
    let metric = "rmse";
    fig.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
      metric = b.dataset.metric;
      fig.querySelectorAll("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      draw();
    }));

    function draw() {
      plot.querySelectorAll("svg").forEach((s) => s.remove());
      const W = Math.max(320, plot.clientWidth), narrow = W < 560;
      const H = narrow ? 300 : 390;
      const m = { l: 48, r: narrow ? 66 : 86, t: 34, b: narrow ? 52 : 58 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const isR = metric === "rmse";
      const y0 = isR ? 0 : 0.4, y1 = isR ? 14 : 0.9, ystep = isR ? 2 : 0.1;
      const xs = (n) => m.l + (n / 210) * iw;
      const ys = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
        "aria-label": `Line chart of ${isR ? "RMSE" : "SSIM"} against the number of readings for five methods. ECDNet is best at every point.` });
      plot.insertBefore(svg, plot.firstChild);
      const fs = narrow ? 12.5 : 14;
      for (let v = y0; v <= y1 + 1e-9; v += ystep) {
        el("line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), stroke: css("--rule"), "stroke-width": 1 }, svg);
        txt(svg, m.l - 8, ys(v) + 4.5, isR ? String(Math.round(v)) : v.toFixed(1), { "text-anchor": "end", "font-size": fs });
      }
      txt(svg, 0, 14, isR ? "RMSE (dBm)" : "SSIM", { "font-size": fs });
      R.readings.forEach((n, i) => {
        txt(svg, xs(n), H - m.b + 20, String(n), { "text-anchor": "middle", "font-size": fs });
        if (!narrow) txt(svg, xs(n), H - m.b + 38, R.percent[i], { "text-anchor": "middle", "font-size": 12.5, fill: css("--ink-3") });
      });
      txt(svg, m.l + iw / 2, H - 4, "Number of readings", { "text-anchor": "middle", "font-size": fs });
      if (isR) {
        const v = R.methods[0].rmse[1];
        el("line", { x1: xs(41), x2: xs(200), y1: ys(v), y2: ys(v), stroke: css("--ecd"), "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 }, svg);
      }
      [...R.methods].reverse().forEach((mm) => {
        const vals = mm[metric];
        const own = mm.id === "ecdnet";
        el("polyline", { points: vals.map((v, i) => `${xs(R.readings[i])},${ys(v)}`).join(" "), fill: "none", stroke: color[mm.id],
          "stroke-width": own ? 2.6 : 2, "stroke-dasharray": dash[mm.id], "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
        vals.forEach((v, i) => el("circle", { cx: xs(R.readings[i]), cy: ys(v), r: own ? 4.5 : 3.5, fill: color[mm.id], stroke: "#fff", "stroke-width": 2 }, svg));
      });
      // end labels, spaced so they do not collide
      const ends = R.methods.map((mm) => ({ name: mm.name, y: ys(mm[metric][5]), id: mm.id })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
      ends.forEach((e) => txt(svg, xs(200) + 10, e.y + 4.5, e.name, { "font-size": fs, fill: e.id === "ecdnet" ? css("--ink") : css("--ink-2"), "font-weight": e.id === "ecdnet" ? 700 : 400 }));

      const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: css("--ink-3"), "stroke-width": 1, opacity: 0 }, svg);
      const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", tabindex: 0,
        "aria-label": "Chart values. Use the left and right arrow keys to move between sampling rates." }, svg);
      let idx = -1;
      function show(i) {
        idx = i; const n = R.readings[i];
        cross.setAttribute("x1", xs(n)); cross.setAttribute("x2", xs(n)); cross.setAttribute("opacity", 1);
        const rows = [...R.methods].sort((a, b) => isR ? a.rmse[i] - b.rmse[i] : b.ssim[i] - a.ssim[i])
          .map((mm) => [color[mm.id], mm.name, isR ? mm.rmse[i].toFixed(3) + " dBm" : mm.ssim[i].toFixed(3)]);
        tip.show(`${n} readings (${R.percent[i]})`, rows, xs(n), m.t);
      }
      function hide() { idx = -1; cross.setAttribute("opacity", 0); tip.hide(); }
      hit.addEventListener("pointermove", (ev) => {
        const box = svg.getBoundingClientRect(), x = (ev.clientX - box.left) * W / box.width;
        let best = 0; R.readings.forEach((n, i) => { if (Math.abs(xs(n) - x) < Math.abs(xs(R.readings[best]) - x)) best = i; });
        show(best);
      });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", () => show(idx < 0 ? 1 : idx));
      hit.addEventListener("blur", hide);
      hit.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowRight") { show(Math.min(R.readings.length - 1, idx + 1)); ev.preventDefault(); }
        if (ev.key === "ArrowLeft") { show(Math.max(0, idx - 1)); ev.preventDefault(); }
        if (ev.key === "Escape") hide();
      });
    }
    draw();
    new ResizeObserver(() => draw()).observe(plot);
  }

  /* ---------- Latency bar ---------- */
  function initLatency() {
    const fig = document.getElementById("latency");
    if (!fig) return;
    const seg = fig.querySelector(".seg");
    const tip = makeTip(fig);
    fig.style.position = "relative";
    function fit() {
      seg.querySelectorAll("span").forEach((s) => {
        const l = s.querySelector(".lbl");
        if (!l) return;
        l.hidden = false;
        if (l.scrollWidth + 12 > s.clientWidth) l.hidden = true;
      });
    }
    seg.querySelectorAll("span").forEach((s) => {
      const on = () => {
        const fb = fig.getBoundingClientRect(), sb = s.getBoundingClientRect();
        tip.show(s.dataset.name, [["", "Average latency", `${s.dataset.ms} ms`]], sb.left - fb.left, sb.bottom - fb.top + 6);
      };
      s.addEventListener("pointerenter", on); s.addEventListener("focus", on);
      s.addEventListener("pointerleave", tip.hide); s.addEventListener("blur", tip.hide);
    });
    fit();
    new ResizeObserver(fit).observe(seg);
  }

  /* ---------- BibTeX ---------- */
  function initBib() {
    const btn = document.getElementById("copy-bib"), code = document.getElementById("bibtex"), state = document.getElementById("copy-state");
    if (!btn || !code || !navigator.clipboard) return;
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code.textContent); state.textContent = "Copied"; }
      catch (e) { state.textContent = "Select the text above to copy it"; }
      setTimeout(() => { state.textContent = ""; }, 2400);
    });
  }

  function start() {
    try { initExplorer(); } catch (e) { console.error(e); }
    if (window.ECDNET_CHARTS) { try { chartRates(window.ECDNET_CHARTS); } catch (e) { console.error(e); } }
    try { initLatency(); } catch (e) { console.error(e); }
    initBib();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
