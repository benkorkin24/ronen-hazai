"use strict";
// Living sky behind the whole app: a storm that breathes (drifting cloud banks, rain, forked
// lightning) and, every so often, clears for a few seconds of sun before closing in again.
(() => {
  const sky = document.getElementById("sky");
  if (!sky) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;                                   // static sky only

  const cv = document.getElementById("skyfx"), g = cv.getContext("2d");
  const flash = sky.querySelector(".sky-flash");
  let W = 0, H = 0, drops = [], bolts = [], rain = 1, rainTarget = 1, sunny = false;

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(220, W * H / 7000));
    drops = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H,
      l: 12 + Math.random() * 18, v: 11 + Math.random() * 9, a: .10 + Math.random() * .25 }));
  }

  // forked bolt: a jagged main channel with a few branches
  function makeBolt() {
    const pts = [], x0 = W * (.15 + Math.random() * .7), yEnd = H * (.45 + Math.random() * .3);
    let x = x0, y = -10;
    while (y < yEnd) { pts.push([x, y]); y += 14 + Math.random() * 26; x += (Math.random() - .5) * 46; }
    const branches = [];
    for (let i = 2; i < pts.length - 2; i++) if (Math.random() < .25) {
      const b = [pts[i]]; let [bx, by] = pts[i]; const dir = Math.random() < .5 ? -1 : 1;
      for (let k = 0; k < 4 + Math.random() * 5; k++) { bx += dir * (8 + Math.random() * 22); by += 10 + Math.random() * 20; b.push([bx, by]); }
      branches.push(b);
    }
    return { pts, branches, life: 1, born: performance.now() };
  }
  function strike() {
    if (sunny || document.hidden) return;
    bolts.push(makeBolt());
    flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
    if (Math.random() < .35) setTimeout(() => bolts.push(makeBolt()), 180 + Math.random() * 220);
  }
  (function schedule() { setTimeout(() => { strike(); schedule(); }, 3500 + Math.random() * 6500); })();

  // weather cycle: ~30 s of storm, then ~11 s of sun breaking through
  (function cycle() {
    setTimeout(() => {
      sunny = true; sky.classList.add("sunny"); rainTarget = .15;
      setTimeout(() => { sunny = false; sky.classList.remove("sunny"); rainTarget = 1; cycle(); }, 11000);
    }, 26000 + Math.random() * 10000);
  })();

  function path(p) { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.stroke(); }

  function frame(t) {
    g.clearRect(0, 0, W, H);
    rain += (rainTarget - rain) * .02;
    g.lineCap = "round"; g.lineWidth = 1;
    for (const d of drops) {
      g.strokeStyle = `rgba(200,218,235,${d.a * rain})`;
      g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * .22, d.y + d.l); g.stroke();
      d.y += d.v; d.x -= d.v * .22;
      if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 120); }
    }
    bolts = bolts.filter((b) => {
      const age = (t - b.born) / 1000;
      const alpha = age < .08 ? 1 : age < .14 ? .25 : age < .22 ? .9 : Math.max(0, 1 - (age - .22) * 3.2);
      if (alpha <= 0) return false;
      g.save();
      g.shadowColor = "rgba(170,205,255,.9)"; g.shadowBlur = 18;
      g.strokeStyle = `rgba(235,244,255,${alpha})`; g.lineWidth = 2.4; path(b.pts);
      g.lineWidth = 1.2; b.branches.forEach(path);
      g.restore();
      return true;
    });
    if (!document.hidden) requestAnimationFrame(frame);
  }
  size();
  addEventListener("resize", size);
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAnimationFrame(frame); });
})();
