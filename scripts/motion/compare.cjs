/**
 * Builds `scripts/motion/compare.html`: a side-by-side, self-contained demonstration of
 * the old easing versus the spring tables, with a live position-over-time trace.
 *
 * This exists because "the animation feels cheap" is not something a report can argue
 * with. The page runs both curves on the same box, at the same time, from the same
 * trigger, and plots what actually happened, so the difference is visible rather than
 * claimed. It is generated from `springs.cjs` so the curves on the page can never drift
 * from the curves in the app.
 *
 * Run: node scripts/motion/compare.cjs --write   →  scripts/motion/compare.html
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const { SPRINGS, springToLinear, peakOf } = require("./springs.cjs");

/**
 * These scripts print their report to stdout, and the generated files are written
 * separately. A one-line writer keeps the output free of the console shim.
 */
const log = (...args) => process.stdout.write(args.join(" ") + "\n");

const here = __dirname;

/**
 * The two things being compared.
 *
 * The old easing is the exact token the app shipped: `--ease-out` and `--ease-spring`
 * were both `cubic-bezier(0.16, 1, 0.3, 1)`, and the panel rail, the press, the drawer
 * and the section reveal all ran it at 140-220ms.
 */
const OLD = { label: "before", easing: "cubic-bezier(0.16, 1, 0.3, 1)", duration: 140, token: "--ease-out (and --ease-spring)" };
const NEW_KEY = "quick";
const NEW = (() => {
    const springs = SPRINGS[NEW_KEY];
    const { easing, durationMs, stops } = springToLinear(springs.bounce, springs.response);
    const { peak } = peakOf(stops);
    return {
        label: "after",
        easing,
        duration: durationMs,
        token: `--spring-${NEW_KEY} (response ${springs.response}s, bounce ${springs.bounce})`,
        peak: Number(((peak - 1) * 100).toFixed(2)),
    };
})();

/** Classify a curve by the properties that decide whether it reads as physical. */
const describe = (easing) => {
    // Sample the curve the way the browser will, then measure it.
    const isLinear = easing.startsWith("linear(");
    let at;
    if (isLinear) {
        const stops = easing
            .slice("linear(".length, -1)
            .split(",")
            .map((s) => Number(s.trim()));
        at = (p) => {
            const i = p * (stops.length - 1);
            const lo = Math.floor(i);
            const hi = Math.min(stops.length - 1, lo + 1);
            return stops[lo] + (stops[hi] - stops[lo]) * (i - lo);
        };
    } else {
        const [x1, y1, x2, y2] = easing.slice("cubic-bezier(".length, -1).split(",").map(Number);
        const cx = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
        const cy = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
        at = (p) => {
            let lo = 0;
            let hi = 1;
            let t = p;
            for (let i = 0; i < 40; i++) {
                if (cx(t) < p) lo = t;
                else hi = t;
                t = (lo + hi) / 2;
            }
            return cy(t);
        };
    }
    const timeTo = (target) => {
        for (let p = 0; p <= 1.0001; p += 0.0005) if (at(p) >= target) return p * 100;
        return null;
    };
    let peak = 0;
    let peakAt = 0;
    for (let p = 0; p <= 1.0001; p += 0.0005) {
        if (at(p) > peak) {
            peak = at(p);
            peakAt = p;
        }
    }
    return {
        half: timeTo(0.5),
        almost: timeTo(0.95),
        deadTail: timeTo(0.95) === null ? null : 100 - timeTo(0.95),
        peak: (peak - 1) * 100,
        peakAt: peakAt * 100,
    };
};

const oldStats = describe(OLD.easing);
const newStats = describe(NEW.easing);
const pct = (v) => (v === null ? "—" : `${v.toFixed(0)}%`);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spring refactor: before and after</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d0d0f;
    --surface: #16161a;
    --line: #26262c;
    --text: #e8e8ea;
    --muted: #9a9aa2;
    --dim: #6c6c74;
    --old: #6c6c74;
    --new: #f05252;
    --accent: #4f7cff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 48px;
    background: var(--bg); color: var(--text);
    font: 400 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Inter, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-size: 19px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 28px; max-width: 62ch; }
  .row { margin-bottom: 26px; }
  .head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px; }
  .tag {
    font: 600 10px/1 ui-monospace, monospace; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 4px 7px; border-radius: 5px; border: 1px solid var(--line); color: var(--muted);
  }
  .tag.new { color: #fff; background: var(--new); border-color: transparent; }
  .head code { font: 500 12px ui-monospace, monospace; color: var(--text); }
  .head .meta { color: var(--dim); font-size: 12px; }
  .track {
    position: relative; height: 46px; border-radius: 10px;
    background: var(--surface); border: 1px solid var(--line); overflow: hidden;
  }
  /* the travel, so the distance is legible even at a glance */
  .track::after {
    content: ""; position: absolute; left: 24px; right: 24px; top: 50%;
    border-top: 1px dashed #2f2f37; transform: translateY(-50%);
  }
  .box {
    position: absolute; top: 50%; left: 24px;
    width: 26px; height: 26px; margin-top: -13px; border-radius: 7px;
    background: var(--old);
  }
  .row.new .box { background: var(--new); }
  .row.before .box { transition-timing-function: ${OLD.easing}; transition-duration: ${OLD.duration}ms; }
  .row.after  .box { transition-timing-function: ${NEW.easing}; transition-duration: ${NEW.duration}ms; }
  .box.moving { transform: translateX(calc(100% + 0px)); }
  /* travel distance is set per row from JS so both rows move the same number of pixels */
  .box { transition-property: translate; }
  .box.go { translate: var(--travel) 0; }
  .stats { display: flex; gap: 20px; margin-top: 8px; color: var(--dim); font-size: 11.5px; }
  .stats b { color: var(--muted); font-weight: 500; }
  canvas { width: 100%; height: 190px; display: block; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); }
  .legend { display: flex; gap: 22px; margin: 10px 0 0; color: var(--muted); font-size: 12px; }
  .key { display: inline-flex; align-items: center; gap: 7px; }
  .swatch { width: 14px; height: 3px; border-radius: 2px; }
  .note { color: var(--dim); font-size: 12px; margin-top: 8px; max-width: 76ch; }
</style>
</head>
<body>
  <h1>The same move, on two curves</h1>
  <p class="sub">
    Both boxes travel the same distance from the same trigger. The grey one runs the token
    this app shipped everywhere (<code>cubic-bezier(0.16, 1, 0.3, 1)</code>); the red one runs
    <code>--spring-quick</code>, sampled from a damped spring. The trace below is drawn from
    the boxes' real positions, not from the maths.
  </p>

  <div class="row before">
    <div class="head">
      <span class="tag">${OLD.label}</span>
      <code>${OLD.easing}</code>
      <span class="meta">${OLD.duration}ms · ${OLD.token}</span>
    </div>
    <div class="track"><div class="box"></div></div>
    <div class="stats">
      <span><b>half way</b> at ${pct(oldStats.half)} of the duration</span>
      <span><b>looks done</b> at ${pct(oldStats.almost)}</span>
      <span><b>then flat</b> for ${pct(oldStats.deadTail)}</span>
      <span><b>visually finished</b> at ${pct(oldStats.almost)}, so the last ${pct(oldStats.deadTail)} of the declared duration carries nothing</span>
    </div>
  </div>

  <div class="row after">
    <div class="head">
      <span class="tag new">${NEW.label}</span>
      <code>spring, response ${SPRINGS[NEW_KEY].response}s bounce ${SPRINGS[NEW_KEY].bounce}</code>
      <span class="meta">${NEW.duration}ms · ${NEW.token}</span>
    </div>
    <div class="track"><div class="box"></div></div>
    <div class="stats">
      <span><b>half way</b> at ${pct(newStats.half)} of the duration</span>
      <span><b>looks done</b> at ${pct(newStats.almost)}</span>
      <span><b>then flat</b> for ${pct(newStats.deadTail)}</span>
      <span><b>visually finished</b> at ${pct(newStats.almost)}, last ${pct(newStats.deadTail)} of the declared duration carries nothing</span>
    </div>
  </div>

  <canvas id="trace"></canvas>
  <div class="legend">
    <span class="key"><span class="swatch" style="background: var(--old)"></span> before</span>
    <span class="key"><span class="swatch" style="background: var(--new)"></span> after</span>
    <span class="key" style="color: var(--dim)">faint dashed = velocity, on a shared scale</span>
  </div>
  <p class="note">
    Read the two traces rather than the boxes. The grey curve leaps away and then flattens:
    it covers half its distance in the first tenth of its duration and has all but finished
    by ${pct(oldStats.almost)}, which means ${pct(oldStats.deadTail)} of the duration the element purports to be
    animating, it is not. The red curve leans forward and keeps leaning: slower to start
    (half way at ${pct(newStats.half)}), still travelling at ${pct(newStats.almost)}, and its final approach is a
    gradual arrival rather than a stop.
    <br><br>
    That is the whole difference the eye reads as weight, and it is not something
    <code>cubic-bezier</code> can be talked out of: a bezier that decelerates into the target
    has to start decelerating early and crawl the last stretch, and one that keeps its speed
    to the end stops dead on the target. A spring's tail is a decay with no endpoint to hit,
    so it arrives still moving and keeps easing the rest of the way in.
    A spring's deceleration is a decay, not an asymptote, which is why the red trace stays
    steep into the target. The faint lines are the same two runs' measured velocities on one
    shared scale, so the grey one collapses to nothing while the red one is still moving.
  </p>

<script>
const OLD_DUR = ${OLD.duration};
const NEW_DUR = ${NEW.duration};
const rows = [...document.querySelectorAll(".row")];
const boxes = rows.map((r) => r.querySelector(".box"));

// Same travel for both rows, measured from the track so neither curve gets an advantage.
const setTravel = () => {
  const track = document.querySelector(".track");
  const travel = track.clientWidth - 24 - 24 - 26;
  for (const box of boxes) box.style.setProperty("--travel", travel + "px");
  return travel;
};
setTravel();
addEventListener("resize", setTravel);

// Trigger both from the same instant, and record what actually happened.
const samples = { before: [], after: [] };
let t0 = 0;
let raf = 0;
const read = (box, name) => {
  const m = getComputedStyle(box).translate.match(/(-?[\\d.]+)px/);
  samples[name].push([performance.now() - t0, m ? Number.parseFloat(m[1]) : 0]);
};
const loop = () => {
  read(boxes[0], "before");
  read(boxes[1], "after");
  draw();
  if (performance.now() - t0 < Math.max(OLD_DUR, NEW_DUR) + 120) raf = requestAnimationFrame(loop);
};
const fire = () => {
  for (const box of boxes) box.classList.remove("go");
  // force a reflow so removing and re-adding the class restarts the transition
  void document.body.offsetWidth;
  samples.before.length = 0;
  samples.after.length = 0;
  t0 = performance.now();
  for (const box of boxes) box.classList.add("go");
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
};
// start over every couple of seconds, forever, so a screen recording always catches it
setTimeout(fire, 350);
setInterval(fire, 2200);

const cv = document.getElementById("trace");
const ctx = cv.getContext("2d");
const draw = () => {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = 34;
  const span = Math.max(OLD_DUR, NEW_DUR) + 40;
  const travel = Number.parseFloat(boxes[0].style.getPropertyValue("--travel")) || 1;
  const X = (ms) => pad + (ms / span) * (w - pad * 2);
  const Y = (px) => h - pad - (px / travel) * (h - pad * 2);

  // grid: 0% and 100% of the travel
  ctx.strokeStyle = "#26262c";
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  for (const v of [0, travel]) {
    ctx.beginPath(); ctx.moveTo(pad, Y(v)); ctx.lineTo(w - pad, Y(v)); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "#6c6c74";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("target", 6, Y(travel) + 3);
  ctx.fillText("start", 6, Y(0) + 3);

  const plot = (name, colour, velocity) => {
    const s = samples[name];
    if (s.length < 3) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = velocity ? 1.5 : 2;
    ctx.setLineDash(velocity ? [4, 3] : []);
    ctx.beginPath();
    s.forEach(([t, v], i) => {
      if (velocity) {
        // Real measured velocity: pixels moved per millisecond, scaled so the peak
        // reaches the top of the plot. Drawn from the sampled positions only.
        // The first sample has nothing behind it to difference against, so it
        // anchors the trace at zero instead of reading a sample that is not there.
        const prev = i > 0 ? s[i - 1] : null;
        const dt = prev ? t - prev[0] : 0;
        const speed = prev && dt > 0 ? (v - prev[1]) / dt : 0;
        const scaled = Math.max(0, Math.min(1, speed / PEAK_SPEED)) * travel;
        i ? ctx.lineTo(X(t), Y(scaled)) : ctx.moveTo(X(t), Y(scaled));
      } else {
        i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v));
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  let PEAK_SPEED = 1;
  {
    // Establish a shared velocity scale from both runs so neither curve is flattered.
    let peak = 0;
    for (const name of ["before", "after"]) {
      const s = samples[name];
      for (let i = 1; i < s.length; i++) {
        const dt = s[i][0] - s[i - 1][0];
        if (dt > 0) peak = Math.max(peak, Math.abs((s[i][1] - s[i - 1][1]) / dt));
      }
    }
    if (peak > 0) PEAK_SPEED = peak;
  }
  // position: solid. velocity: dashed, on a shared scale.
  plot("before", "#6c6c74", false);
  plot("after", "#f05252", false);
  plot("before", "#7d7d88", true);
  plot("after", "#b8564f", true);
};
draw();
</script>
</body>
</html>
`;

if (process.argv.includes("--write")) {
    const out = join(here, "compare.html");
    writeFileSync(out, html);
    log(`wrote ${out} (${html.length} bytes)`);
    log(`  before: half way at ${pct(oldStats.half)}, effectively done at ${pct(oldStats.almost)}, ${pct(oldStats.deadTail)} of the duration carries nothing`);
    log(`  after:  half way at ${pct(newStats.half)}, effectively done at ${pct(newStats.almost)}, ${pct(newStats.deadTail)} of the duration carries nothing`);
} else {
    log("pass --write to generate scripts/motion/compare.html");
}
