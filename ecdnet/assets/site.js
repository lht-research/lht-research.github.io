(() => {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  /* ---------- Explorer ---------- */
  function initExplorer() {
    const D = window.ECDNET_EXPLORER;
    if (!D) return;
    const N = 64, TOTAL = 164, E_AT = 41;
    const lut = new Uint8Array(768);
    for (let i = 0; i < 768; i++) lut[i] = parseInt(D.lut.substr(i * 2, 2), 16);
    const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const cache = new Map();
    function mapCanvas(key, b64) {
      if (cache.has(key)) return cache.get(key);
      const v = decode(b64);
      const c = document.createElement("canvas");
      c.width = N; c.height = N;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const q = v[y * N + x], o = ((N - 1 - y) * N + x) * 4;
          img.data[o] = lut[q * 3]; img.data[o + 1] = lut[q * 3 + 1]; img.data[o + 2] = lut[q * 3 + 2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      cache.set(key, c);
      return c;
    }

    const panels = {};
    document.querySelectorAll(".panel").forEach((fig) => {
      panels[fig.dataset.panel] = { canvas: fig.querySelector("canvas") };
    });
    const valE = document.getElementById("val-ecdnet");
    const valU = document.getElementById("val-unet");
    const count = document.getElementById("count");
    const scrub = document.getElementById("scrub");
    const replay = document.getElementById("replay");
    const chips = document.getElementById("route-chips");
    const note = document.getElementById("route-note");
    const cbar = document.querySelector(".cbar");

    let route = D.routes[0];
    let t = TOTAL;            // readings collected, may be fractional during playback
    let anim = null;
    const fade = { e: 1, u: 1, eStart: 0, uStart: 0 };

    D.routes.forEach((r, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = r.name;
      b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.addEventListener("click", () => {
        chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        route = r; stop(); setT(TOTAL, false);
      });
      chips.appendChild(b);
    });

    function sizeCanvas(cv) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cv.clientWidth * dpr);
      if (cv.width !== w || cv.height !== w) { cv.width = w; cv.height = w; }
      return w;
    }

    function cellXY(p, s) { return [(p[0] + 0.5) * s, (N - 1 - p[1] + 0.5) * s]; }

    function drawObstacles(ctx, s, color, fill) {
      ctx.save();
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.strokeStyle = color;
      D.obstacles.forEach(([x0, y0, x1, y1]) => {
        const X = x0 * s, Y = (N - y1) * s, W = (x1 - x0) * s, H = (y1 - y0) * s;
        if (fill) { ctx.fillStyle = fill; ctx.fillRect(X, Y, W, H); }
        ctx.strokeRect(X + ctx.lineWidth / 2, Y + ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
      });
      ctx.restore();
    }

    function drawRoute(ctx, s, upto, dots) {
      const pts = route.path;
      const n = Math.min(pts.length, Math.floor(upto));
      if (n < 1) return;
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = Math.max(1.2, s * 0.2);
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = cellXY(pts[i], s); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      const frac = upto - Math.floor(upto);
      if (frac > 0 && n < pts.length) {
        const [x0, y0] = cellXY(pts[n - 1], s), [x1, y1] = cellXY(pts[n], s);
        ctx.lineTo(x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac);
      }
      ctx.stroke();
      if (dots) {
        const r = Math.max(1.6, s * 0.28);
        for (let i = 0; i < n; i++) {
          const [x, y] = cellXY(pts[i], s);
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.lineWidth = Math.max(1, s * 0.12); ctx.strokeStyle = "rgba(20,23,42,0.85)"; ctx.stroke();
        }
      }
      ctx.restore();
    }

    function drawUav(ctx, s, upto) {
      const pts = route.path;
      const i = Math.min(pts.length - 1, Math.max(0, Math.floor(upto) - 1));
      let [x, y] = cellXY(pts[i], s);
      const frac = upto - Math.floor(upto);
      if (frac > 0 && i + 1 < pts.length) { const [x1, y1] = cellXY(pts[i + 1], s); x += (x1 - x) * frac; y += (y1 - y) * frac; }
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, Math.max(8, s * 1.5), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, Math.max(4, s * 0.75), 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.lineWidth = Math.max(1.2, s * 0.16); ctx.strokeStyle = "#14172a"; ctx.stroke();
      ctx.restore();
    }

    function star(ctx, cx, cy, R) {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R;
        ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      ctx.closePath();
    }

    function drawTx(ctx, s) {
      ctx.save();
      D.tx.forEach((p) => {
        const [x, y] = cellXY(p, s);
        star(ctx, x, y, Math.max(7, s * 1.6));
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.lineWidth = Math.max(1.2, s * 0.18); ctx.strokeStyle = "#14172a"; ctx.stroke();
      });
      ctx.restore();
    }

    function drawEmpty(ctx, w, s) {
      ctx.fillStyle = "#1d2138"; ctx.fillRect(0, 0, w, w);
      ctx.save();
      ctx.strokeStyle = "rgba(169,174,198,0.10)"; ctx.lineWidth = 1;
      for (let k = 8; k < N; k += 8) {
        ctx.beginPath(); ctx.moveTo(k * s, 0); ctx.lineTo(k * s, w); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, k * s); ctx.lineTo(w, k * s); ctx.stroke();
      }
      ctx.restore();
      drawObstacles(ctx, s, "rgba(169,174,198,0.55)");
    }

    function drawPanel(name) {
      const cv = panels[name].canvas;
      const w = sizeCanvas(cv), s = w / N;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, w);
      if (name === "truth") {
        ctx.drawImage(mapCanvas("truth", D.truth), 0, 0, w, w);
        drawObstacles(ctx, s, "#14172a");
        drawRoute(ctx, s, t, false);
        drawTx(ctx, s);
        if (t > 0 && t < TOTAL) drawUav(ctx, s, t);
        return;
      }
      const limit = name === "ecdnet" ? E_AT : TOTAL;
      const alpha = name === "ecdnet" ? fade.e : fade.u;
      drawEmpty(ctx, w, s);
      if (t >= limit) {
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.drawImage(mapCanvas(route.id + name, route[name]), 0, 0, w, w);
        ctx.restore();
        ctx.save(); ctx.globalAlpha = alpha; drawObstacles(ctx, s, "#14172a"); ctx.restore();
      }
      drawRoute(ctx, s, Math.min(t, limit), true);
    }

    function captions() {
      const r = route.rmse, n = Math.floor(t);
      valE.innerHTML = t >= E_AT
        ? `<strong>RMSE ${r.e35.toFixed(2)} dBm</strong> at 3.5 GHz<br>${r.e4.toFixed(2)} dBm over four bands`
        : `Reconstruction at reading 41<br>${Math.min(n, E_AT)} of 41 readings`;
      valU.innerHTML = t >= TOTAL
        ? `<strong>RMSE ${r.u35.toFixed(2)} dBm</strong> at 3.5 GHz<br>${r.u4.toFixed(2)} dBm over four bands`
        : `Reconstruction at reading 164<br>${n} of 164 readings`;
      count.innerHTML = `<strong>${n}</strong> of 164 readings`;
      note.textContent = route.note;
    }

    function render() {
      ["truth", "ecdnet", "unet"].forEach(drawPanel);
      captions();
      if (cbar) cbar.style.setProperty("--cbar-h", panels.truth.canvas.clientHeight + "px");
    }

    function setT(v, fromPlay) {
      const prev = t;
      t = v;
      if (fromPlay) {
        const now = performance.now();
        if (prev < E_AT && t >= E_AT) { fade.e = 0; fade.eStart = now; }
        if (prev < TOTAL && t >= TOTAL) { fade.u = 0; fade.uStart = now; }
      } else { fade.e = 1; fade.u = 1; }
      scrub.value = Math.floor(t);
      if (!fromPlay) render();
    }

    function stop() { if (anim) { cancelAnimationFrame(anim); anim = null; } }

    function play() {
      stop();
      if (reduceMotion) { setT(TOTAL, false); return; }
      const rate = 30, hold = 650;          // readings per second, pause after reading 41
      const tHold = E_AT / rate * 1000;
      const start = performance.now();
      setT(0, true);
      render();
      const step = (now) => {
        const el = now - start;
        let v = el < tHold ? el / 1000 * rate : el < tHold + hold ? E_AT : E_AT + (el - tHold - hold) / 1000 * rate;
        v = Math.min(TOTAL, v);
        setT(v, true);
        fade.e = Math.min(1, (now - fade.eStart) / 380);
        fade.u = Math.min(1, (now - fade.uStart) / 380);
        render();
        if (v < TOTAL || fade.u < 1) anim = requestAnimationFrame(step); else anim = null;
      };
      anim = requestAnimationFrame(step);
    }

    scrub.addEventListener("input", () => { stop(); setT(+scrub.value, false); });
    replay.addEventListener("click", play);
    new ResizeObserver(() => render()).observe(panels.truth.canvas);
    render();
    if (!reduceMotion) setTimeout(play, 500);
  }

  /* ---------- Shared chart helpers ---------- */
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, s, attrs) { const t = el("text", Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; }
  function legend(ul, items) {
    ul.textContent = "";
    items.forEach(([label, color, kind]) => {
      const li = document.createElement("li");
      const k = document.createElement("span");
      k.className = kind === "dot" ? "key dot" : "key";
      k.style.background = color;
      li.appendChild(k); li.appendChild(document.createTextNode(label));
      ul.appendChild(li);
    });
  }
  function makeTip(plot) {
    const tip = document.createElement("div");
    tip.className = "tip"; tip.setAttribute("aria-hidden", "true");
    plot.appendChild(tip);
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
        const pw = plot.clientWidth, tw = tip.offsetWidth || 220;
        tip.style.left = Math.max(0, Math.min(pw - tw, x + 14)) + "px";
        tip.style.top = Math.max(0, y - 10) + "px";
        tip.classList.add("on");
      },
      hide() { tip.classList.remove("on"); },
    };
  }
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  /* ---------- Chart: RMSE against readings ---------- */
  function chartRates(C) {
    const fig = document.getElementById("chart-rates");
    if (!fig) return;
    const plot = fig.querySelector(".plot");
    const R = C.rates;
    const color = { ecdnet: css("--ecd"), unet: css("--unet"), kgnet: css("--grey-1"), ae3d: css("--grey-2"), kriging: css("--grey-3") };
    legend(document.getElementById("legend-rates"), R.methods.map((m) => [m.name, color[m.id], "line"]));
    const tip = makeTip(plot);

    function draw() {
      plot.querySelectorAll("svg").forEach((s) => s.remove());
      const W = Math.max(320, plot.clientWidth), narrow = W < 560;
      const H = narrow ? 300 : 380;
      const m = { l: 44, r: narrow ? 64 : 82, t: 34, b: narrow ? 52 : 56 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const xs = (n) => m.l + (n / 210) * iw;
      const ys = (v) => m.t + ih - (v / 14) * ih;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
        "aria-label": "Line chart of RMSE against the number of readings for five methods. ECDNet is lowest at every point." });
      plot.insertBefore(svg, plot.firstChild);
      const fs = narrow ? 12.5 : 14;
      for (let v = 0; v <= 14; v += 2) {
        el("line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), stroke: css("--rule"), "stroke-width": 1 }, svg);
        txt(svg, m.l - 8, ys(v) + 4.5, String(v), { "text-anchor": "end", "font-size": fs });
      }
      txt(svg, 0, 14, "RMSE (dBm)", { "font-size": fs });
      R.readings.forEach((n, i) => {
        txt(svg, xs(n), H - m.b + 20, String(n), { "text-anchor": "middle", "font-size": fs });
        if (!narrow) txt(svg, xs(n), H - m.b + 38, R.percent[i], { "text-anchor": "middle", "font-size": 12.5, fill: css("--ink-3") });
      });
      txt(svg, m.l + iw / 2, H - 4, "Number of readings", { "text-anchor": "middle", "font-size": fs });
      // lines, greys first so the two compared methods sit on top
      [...R.methods].reverse().forEach((mm) => {
        const pts = mm.rmse.map((v, i) => `${xs(R.readings[i])},${ys(v)}`).join(" ");
        el("polyline", { points: pts, fill: "none", stroke: color[mm.id], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
        mm.rmse.forEach((v, i) => el("circle", { cx: xs(R.readings[i]), cy: ys(v), r: 4, fill: color[mm.id], stroke: "#fff", "stroke-width": 2 }, svg));
      });
      // end labels
      R.methods.forEach((mm) => {
        const v = mm.rmse[mm.rmse.length - 1];
        txt(svg, xs(200) + 10, ys(v) + 4.5, mm.name, { "font-size": fs, fill: css("--ink") });
      });
      // the two operating points discussed in the text
      const e41 = R.methods[0].rmse[1], u164 = R.methods[1].rmse[4];
      el("line", { x1: xs(41), x2: xs(164), y1: ys(e41), y2: ys(e41), stroke: css("--ecd"), "stroke-width": 1, opacity: 0.45 }, svg);
      txt(svg, xs(41), ys(e41) + 20, e41.toFixed(3), { "text-anchor": "middle", "font-size": fs, fill: css("--ink") });
      txt(svg, xs(164), ys(u164) - 11, u164.toFixed(3), { "text-anchor": "middle", "font-size": fs, fill: css("--ink") });

      // crosshair layer
      const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: css("--ink-3"), "stroke-width": 1, opacity: 0 }, svg);
      const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", tabindex: 0,
        "aria-label": "Chart values. Use the left and right arrow keys to move between sampling rates." }, svg);
      let idx = -1;
      function show(i) {
        idx = i; const n = R.readings[i];
        cross.setAttribute("x1", xs(n)); cross.setAttribute("x2", xs(n)); cross.setAttribute("opacity", 1);
        const rows = [...R.methods].sort((a, b) => a.rmse[i] - b.rmse[i]).map((mm) => [color[mm.id], mm.name, mm.rmse[i].toFixed(3) + " dBm"]);
        tip.show(`${n} readings (${R.percent[i]})`, rows, xs(n) * plot.clientWidth / W, m.t);
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

  /* ---------- Chart: nine routes ---------- */
  function chartRoutes(C) {
    const fig = document.getElementById("chart-routes");
    if (!fig) return;
    const plot = fig.querySelector(".plot");
    const R = C.routes;
    const ce = css("--ecd"), cu = css("--unet");
    legend(document.getElementById("legend-routes"), [["ECDNet, first 41 readings", ce, "dot"], ["U-Net, first 164 readings", cu, "dot"]]);
    const tip = makeTip(plot);

    function draw() {
      plot.querySelectorAll("svg").forEach((s) => s.remove());
      const W = Math.max(320, plot.clientWidth), narrow = W < 560;
      const fs = narrow ? 12.5 : 14;
      const row = narrow ? 34 : 38;
      const m = { l: narrow ? 128 : 190, r: 18, t: 8, b: 46 };
      const H = m.t + row * R.length + m.b;
      const iw = W - m.l - m.r;
      const xs = (v) => m.l + (v / 9) * iw;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
        "aria-label": "Dot plot of mean RMSE with confidence intervals along nine routes. ECDNet is lower along every route." });
      plot.insertBefore(svg, plot.firstChild);
      for (let v = 0; v <= 9; v++) {
        el("line", { x1: xs(v), x2: xs(v), y1: m.t, y2: m.t + row * R.length, stroke: css("--rule"), "stroke-width": 1 }, svg);
        txt(svg, xs(v), m.t + row * R.length + 20, String(v), { "text-anchor": "middle", "font-size": fs });
      }
      txt(svg, m.l + iw / 2, H - 6, "Mean RMSE (dBm)", { "text-anchor": "middle", "font-size": fs });
      R.forEach((r, i) => {
        const y = m.t + row * i + row / 2;
        const g = el("g", { tabindex: 0, role: "listitem",
          "aria-label": `${r.name}. ECDNet ${r.e[0].toFixed(3)} dBm, U-Net ${r.u[0].toFixed(3)} dBm, ECDNet lower in ${r.wins} of ${r.scenes} scenes.` }, svg);
        el("rect", { x: 0, y: y - row / 2, width: W, height: row, fill: "transparent", class: "hitrow" }, g);
        txt(g, m.l - 14, y + 4.5, r.name, { "text-anchor": "end", "font-size": fs, fill: css("--ink") });
        el("line", { x1: xs(r.e[0]), x2: xs(r.u[0]), y1: y, y2: y, stroke: css("--grey-3"), "stroke-width": 1.5 }, g);
        [[r.e, ce, -4], [r.u, cu, 4]].forEach(([v, c, dy]) => {
          el("line", { x1: xs(v[1]), x2: xs(v[2]), y1: y + dy, y2: y + dy, stroke: c, "stroke-width": 2, "stroke-linecap": "round", opacity: 0.55 }, g);
          el("circle", { cx: xs(v[0]), cy: y + dy, r: 5, fill: c, stroke: "#fff", "stroke-width": 2 }, g);
        });
        const on = () => {
          g.querySelector(".hitrow").setAttribute("fill", "rgba(43,98,168,0.06)");
          tip.show(r.name, [
            [ce, "ECDNet, 41 readings", `${r.e[0].toFixed(3)} dBm`],
            ["", "95% CI", `${r.e[1].toFixed(2)} to ${r.e[2].toFixed(2)}`],
            [cu, "U-Net, 164 readings", `${r.u[0].toFixed(3)} dBm`],
            ["", "95% CI", `${r.u[1].toFixed(2)} to ${r.u[2].toFixed(2)}`],
            ["", "Paired difference", `${r.d[0].toFixed(3)} dB`],
            ["", "ECDNet lower in", `${r.wins} of ${r.scenes}`],
          ], xs(r.u[0]) * plot.clientWidth / W, (y + row / 2) * plot.clientWidth / W);
        };
        const off = () => { g.querySelector(".hitrow").setAttribute("fill", "transparent"); tip.hide(); };
        g.addEventListener("pointerenter", on); g.addEventListener("pointerleave", off);
        g.addEventListener("focus", on); g.addEventListener("blur", off);
      });
      svg.setAttribute("role", "list");
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
    if (window.ECDNET_CHARTS) {
      try { chartRates(window.ECDNET_CHARTS); } catch (e) { console.error(e); }
      try { chartRoutes(window.ECDNET_CHARTS); } catch (e) { console.error(e); }
    }
    try { initLatency(); } catch (e) { console.error(e); }
    initBib();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
