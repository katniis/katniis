// Pixel-art sakura grown from your GitHub contributions, rendered as an animated SVG.
// Tree generator ported from csakura's detail mode (MIT, (c) 2026 realstrawhat):
// https://github.com/realstrawhat/csakura
//
// How contributions shape the tree:
//   last 30 days  -> how much of the crown is in bloom, and how many petals fall
//   7+ day streak -> weeping form (shidare); very busy month -> full bloom (bush)
//   idle 7+ days  -> bare branches, no falling petals
//   this year     -> tree size
//
// Usage: GITHUB_TOKEN=... node scripts/sakura.mjs <login> <out.svg>
//        node scripts/sakura.mjs --demo <out.svg>   (offline, fake data)
import { writeFileSync } from "node:fs";

const RAMP = ["#ffe3f1", "#ffd0e7", "#ffb3d9", "#ff8fc6", "#f76fae", "#e05593", "#c13d78", "#97295c"];
const TRUNK_D = "#4a2c19", TRUNK_M = "#7d4d27", TRUNK_L = "#a8703c";
const GRASS = "#87a985", BG_TOP = "#1a1322", BG_BOT = "#120e18";

const F_P0 = 0, F_TRUNK_D = 8, F_TRUNK_M = 9, F_TRUNK_L = 10, F_GRASS = 11, F_GRASS_M = 12, F_GRASS_D = 13;
const PK_NONE = 0, PK_WOOD = 1, PK_BLOOM = 2, PK_GROUND = 3;
const HD_MAX_NODES = 8000, HD_MAX_ATTR = 2000;

const FORMS = {
  yoshino: { crown: [0.54, 0.64], spread: [1.15, 1.40], maxw: 0.80, lean: 0.12 },
  bush:    { crown: [0.58, 0.68], spread: [1.05, 1.25], maxw: 0.78, lean: 0.08 },
  shidare: { crown: [0.46, 0.54], spread: [0.95, 1.15], maxw: 0.70, lean: 0.06 },
};
const BUNDLES = [
  ["..###..", ".#####.", "#######", ".#####.", "..#.#.."],
  [".##.##.", "#######", "#######", ".#####.", "...#..."],
  ["..##...", ".####.#", "#######", "######.", ".##.#.."],
  [".###...", "#####..", "######.", ".######", "..#.##."],
];
const SPRIG = [".###.", "#####", "#####", ".#.#."];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

/** Contribution days (oldest -> newest, {count}) -> tree parameters. */
export function traits(days) {
  const recent = days.slice(-30).reduce((a, d) => a + d.count, 0);
  const year = days.reduce((a, d) => a + d.count, 0);
  let streak = 0;
  // today may have no commits yet, so a streak can still be alive ending yesterday
  for (let i = days.length - 1 - (days.at(-1)?.count ? 0 : 1); i >= 0 && days[i].count > 0; i--) streak++;
  const idle = days.slice(-7).every((d) => d.count === 0);
  return {
    recent, year, streak, idle,
    form: streak >= 7 ? "shidare" : recent >= 60 ? "bush" : "yoshino",
    bloom: idle ? 0.04 : clamp(0.25 + recent / 60, 0.25, 1),
    size: clamp(0.55 + year / 3000, 0.55, 0.8), // capped so the image never fills the full frame height
    // always some falling; an idle tree only drops a few faded petals
    petals: idle ? 15 : clamp(recent, 20, 90),
  };
}

export function render(days, seedStr = "sakura", pw = 240, ph = 150, PX = 4) {
  const T = traits(days);
  let s = 2166136261;
  for (const c of seedStr) s = Math.imul(s ^ c.charCodeAt(0), 16777619);
  const random = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ 0x9e3779b9) >>> 0) / 4294967296;
  const rand = (a, b) => a + random() * (b - a);
  const pickIn = (r) => rand(r[0], r[1]);

  const pix = new Uint8Array(pw * ph), pkind = new Uint8Array(pw * ph);
  const hnodes = [], sources = [];
  const pxSet = (x, y, f, kind) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= pw || y >= ph) return;
    pix[y * pw + x] = f + 1; pkind[y * pw + x] = kind;
  };
  const pxKind = (x, y) => (x < 0 || y < 0 || x >= pw || y >= ph ? PK_NONE : pkind[y * pw + x]);
  const addNode = (x, y, parent) => {
    if (hnodes.length >= HD_MAX_NODES) return -1;
    hnodes.push({ x, y, r: 0, parent, kids: 0, last: -1 });
    const i = hnodes.length - 1;
    if (parent >= 0) { hnodes[parent].kids++; hnodes[parent].last = i; }
    return i;
  };

  function woodSegment(a, b, inner) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const steps = ((len / 0.35) | 0) + 1;
    const nx = len > 0 ? -dy / len : 1, ny = len > 0 ? dx / len : 0;
    const face = nx * 0.6 - ny * 0.8 >= 0 ? 1 : -1;
    for (let st = 0; st <= steps; st++) {
      const t = st / steps, x = a.x + dx * t, y = a.y + dy * t, rr = a.r + (b.r - a.r) * t;
      if (rr < 0.75) { pxSet(x, y, rr < 0.5 || inner ? F_TRUNK_D : F_TRUNK_M, PK_WOOD); continue; }
      for (let py = Math.floor(y - rr); py <= Math.ceil(y + rr); py++)
        for (let px = Math.floor(x - rr); px <= Math.ceil(x + rr); px++) {
          const ox = px + 0.5 - x, oy = py + 0.5 - y;
          if (ox * ox + oy * oy > rr * rr) continue;
          const lit = ((ox * nx + oy * ny) / rr) * face;
          pxSet(px, py, inner ? (lit > 0.35 ? F_TRUNK_M : F_TRUNK_D)
            : lit < -0.35 ? F_TRUNK_D : lit > 0.35 ? F_TRUNK_L : F_TRUNK_M, PK_WOOD);
        }
    }
  }

  function stamp(rows, x0, y0, k, f, sparkle) {
    const w = Math.ceil(rows[0].length * k), h = Math.ceil(rows.length * k);
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const r = Math.floor(py / k), c = Math.floor(px / k);
        if (r >= rows.length || c >= rows[0].length || rows[r][c] !== "#") continue;
        pxSet(x0 + px, y0 + py, sparkle && random() < 0.06 ? F_P0 : f, PK_BLOOM);
      }
  }

  // ---- layout (csakura hdGrow) ----
  const form = T.form, F = FORMS[form], weep = form === "shidare";
  const ground = ph - 3;
  const tall = Math.max(Math.min(ground - 8, pw * 0.95) * T.size, 8);
  const crown = tall * pickIn(F.crown);
  const wide = 1 + 0.3 * clamp((pw / tall - 2) / 2, 0, 1);
  const width = Math.min(pw * F.maxw * T.size, tall * pickIn(F.spread) * wide);
  const rx = Math.max(width * 0.5, 4), ry = Math.max(crown * 0.5, 3);
  const mid = pw * 0.5 + rand(-1, 1) * 2;
  const lean = rand(-1, 1) * F.lean * rx;
  const cx = mid + lean * 0.5, cy = ground - tall + ry, bx = mid - lean * 0.5;
  const step = Math.max(1, tall / 70), infl = step * 7, kill = step * 2;
  const scale = clamp(tall / 70, 1, 3.5);

  // ground + fallen petals (more petals on the ground the busier your year)
  for (let x = 0; x < pw; x++) {
    const dx = (x - bx) / (rx * 1.3), p = Math.exp(-dx * dx * 2);
    const grass = p > 0.55 ? F_GRASS : p > 0.2 ? F_GRASS_M : F_GRASS_D;
    pxSet(x, ph - 1, grass, PK_GROUND);
    if (random() < 0.45 + 0.45 * p) pxSet(x, ph - 2, random() < 0.3 ? F_GRASS_M : grass, PK_GROUND);
    if (random() < p * 0.45 * T.bloom) pxSet(x, ph - 2, 1 + ((random() * 3) | 0), PK_GROUND);
    if (random() < p * 0.15 * T.bloom) pxSet(x, ph - 3, 1 + ((random() * 3) | 0), PK_GROUND);
  }

  // attraction points fill a lobed crown
  const attrs = [];
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28), p3 = rand(0, 6.28);
  const cut = weep ? 0.4 : 0.72;
  const want = clamp((Math.PI * rx * ry) / (kill * kill * 1.6), 40, HD_MAX_ATTR) | 0;
  for (let tries = 0; attrs.length < want && tries < want * 20; tries++) {
    const u = rand(-1.15, 1.15), v = rand(-1.15, 1.15);
    if (v > cut) continue;
    const th = Math.atan2(v, u);
    const lobe = 1 + 0.13 * Math.sin(3 * th + p1) + 0.08 * Math.sin(5 * th + p2) + 0.05 * Math.sin(7 * th + p3);
    if (u * u + v * v > lobe * lobe) continue;
    attrs.push({ x: cx + u * rx, y: cy + v * ry, d: 1e9, near: -1 });
  }

  // scaffold limbs from a low fork
  const forkY = ground - tall * (weep ? rand(0.34, 0.42) : rand(0.26, 0.34));
  const crownB = cy + ry * cut;
  if (forkY > crownB) {
    const limbs = 3 + ((random() * 3) | 0);
    for (let i = 0; i < limbs; i++) {
      const sx = (((i + 0.5) / limbs) * 2 - 1) * rx * 0.5 + rand(-0.06, 0.06) * rx;
      const ex = cx + sx, ey = crownB + rand(-0.1, 0.15) * ry;
      const n = ((Math.hypot(ex - bx, ey - forkY) / (infl * 0.5)) | 0) + 1;
      for (let k = 1; k <= n && attrs.length < HD_MAX_ATTR; k++) {
        const t = k / n, tx = 1 - (1 - t) * (1 - t);
        attrs.push({ x: bx + (ex - bx) * tx, y: forkY + (ey - forkY) * t, d: 1e9, near: -1 });
      }
    }
  }

  // trunk grows along a gentle S up to the fork
  let tip = addNode(bx, ground + 1, -1);
  const targetX = cx - lean * 0.1, targetY = forkY > crownB ? forkY : cy + ry * 0.55;
  const sway = rand(-1, 1) * tall * 0.05;
  for (let guard = 0; guard < 600 && tip >= 0; guard++) {
    const n = hnodes[tip];
    if (n.y <= targetY || attrs.some((a) => Math.hypot(a.x - n.x, a.y - n.y) < infl)) break;
    const t = clamp((ground + 1 - (n.y - step)) / Math.max(ground + 1 - targetY, 1), 0, 1);
    const dx = (bx + (targetX - bx) * t + sway * Math.sin(t * Math.PI) - n.x) / step, l = Math.hypot(dx, -1);
    tip = addNode(n.x + (dx / l) * step, n.y - step / l, tip);
  }
  for (const a of attrs)
    for (let i = 0; i < hnodes.length; i++) {
      const d = Math.hypot(a.x - hnodes[i].x, a.y - hnodes[i].y);
      if (d < a.d) { a.d = d; a.near = i; }
    }

  // space colonisation
  const outK = weep ? 0.25 : 0.2, downK = weep ? 0.35 : 0.1;
  for (let iter = 0; iter < 500; iter++) {
    const n0 = hnodes.length;
    const gx = new Float32Array(n0), gy = new Float32Array(n0), gc = new Int32Array(n0);
    let pulled = false;
    for (let reach = infl; !pulled && reach <= infl * 8; reach *= 2)
      for (const a of attrs) {
        if (a.near < 0 || a.d > reach) continue;
        const n = hnodes[a.near], d = Math.max(a.d, 1e-3);
        gx[a.near] += (a.x - n.x) / d; gy[a.near] += (a.y - n.y) / d; gc[a.near]++;
        pulled = true;
      }
    if (!pulled) break;
    for (let i = 0; i < n0; i++) {
      const n = hnodes[i];
      if (!gc[i] || n.kids >= 3) continue;
      let dx = gx[i], dy = gy[i], l = Math.hypot(dx, dy);
      if (l < 1e-3) { dx = rand(-1, 1); dy = -1; l = Math.hypot(dx, dy); }
      const off = (n.x - cx) / rx;
      dx = dx / l + off * outK; dy = dy / l + Math.abs(off) * downK;
      l = Math.hypot(dx, dy);
      const nx = n.x + (dx / l) * step, ny = n.y + (dy / l) * step;
      if (n.last >= 0 && Math.hypot(hnodes[n.last].x - nx, hnodes[n.last].y - ny) < step * 0.5) continue;
      if (addNode(nx, ny, i) < 0) break;
    }
    if (hnodes.length === n0) break;
    for (const a of attrs) {
      if (a.near < 0) continue;
      for (let j = n0; j < hnodes.length; j++) {
        const d = Math.hypot(a.x - hnodes[j].x, a.y - hnodes[j].y);
        if (d < a.d) { a.d = d; a.near = j; }
      }
      if (a.d < kill) a.near = -1;
    }
  }

  // pipe-model thickness
  const acc = new Float64Array(hnodes.length);
  for (let i = hnodes.length - 1; i >= 0; i--) {
    const n = hnodes[i];
    n.r = n.kids === 0 ? 0.35 : Math.pow(acc[i], 1 / 2.4);
    if (n.parent >= 0) acc[n.parent] += Math.pow(n.r, 2.4);
  }
  const kk = clamp((tall * 0.04) / Math.max(hnodes[0].r, 0.1), 0.4, 3.0);
  for (const n of hnodes) {
    n.r = Math.max(n.r * kk, 0.35);
    const up = (ground - n.y) / (tall * 0.08);
    if (up < 1) n.r *= 1 + 0.6 * (1 - Math.max(up, 0));
  }

  // wood + lenticels
  for (const n of hnodes) if (n.parent >= 0) woodSegment(hnodes[n.parent], n, false);
  for (const n of hnodes) {
    if (n.r < 2.2 || random() > 0.12) continue;
    const y = Math.floor(n.y), half = n.r * rand(0.25, 0.55);
    for (let x = Math.ceil(n.x - half); x <= Math.floor(n.x + half); x++)
      if (pxKind(x, y) === PK_WOOD) pxSet(x, y, F_TRUNK_D, PK_WOOD);
  }

  // blossom bundles; T.bloom decides how many survive (your last 30 days)
  const k = Math.max(1, scale * 0.75), twig = Math.max(0.9, scale * 0.8);
  const spread = k * (form === "bush" ? 2.2 : 1.6);
  const bundles = [];
  for (let i = 1; i < hnodes.length; i++) {
    const nd = hnodes[i];
    const w = nd.kids === 0 ? 2 : nd.r < twig ? 1 : form === "bush" && nd.r < twig * 2.5 ? 1 : 0;
    if (nd.y > cy + ry) continue;
    for (let j = 0; j < w; j++) {
      const y = nd.y + rand(-spread, spread) * 0.6, h = clamp((y - (cy - ry)) / (2 * ry), 0, 1);
      const b = { x: nd.x + rand(-spread, spread), y, shape: (random() * 4) | 0,
        lo: h > 0.62 + rand(-0.15, 0.15) ? 1 : 0, mid: random() < 0.88, lit: random() < 0.62 - h * 0.5 };
      if (random() < T.bloom) bundles.push(b);
    }
  }
  for (const b of bundles) stamp(BUNDLES[b.shape], b.x - 3.5 * k, b.y - 2.5 * k, k, 5 + b.lo, false);
  for (const b of bundles) {
    if (!b.mid) continue;
    stamp(BUNDLES[b.shape], b.x - 2.5 * k, b.y - 3.5 * k, k, 3 + b.lo, false);
    if (random() < 0.5) sources.push([b.x, b.y]);
  }
  for (const b of bundles) if (b.lit) stamp(SPRIG, b.x - 0.5 * k, b.y - 4 * k, k, 1 + b.lo, true);

  // limbs crossing in front of the blossom
  const front = new Uint8Array(hnodes.length);
  for (let i = 1; i < hnodes.length; i++) {
    const pa = hnodes[i].parent;
    front[i] = hnodes[pa].kids > 1 ? (random() < 0.35 ? 1 : 0) : front[pa];
  }
  const limb = Math.max(0.9, scale * 0.7);
  for (let i = 1; i < hnodes.length; i++) {
    const nd = hnodes[i];
    if (!front[i] || nd.r < limb || nd.y > cy + ry * 0.9) continue;
    const pa = hnodes[nd.parent];
    woodSegment({ ...pa, r: pa.r * 0.7 }, { ...nd, r: nd.r * 0.7 }, true);
  }

  // weeping curtains
  if (weep)
    for (const n of hnodes) {
      const frac = Math.abs(n.x - cx) / Math.max(rx, 1);
      if (n.kids !== 0 || frac < 0.2 || random() < 0.4 + 0.6 * (1 - T.bloom)) continue;
      const len = (ground - n.y) * (0.3 + 0.6 * Math.min(frac, 1)) * rand(0.6, 1.0);
      const drift = rand(0.02, 0.06) * (n.x < cx ? -1 : 1), phase = rand(0, 6.28);
      for (let q = 1; q < (len | 0); q++) {
        const t = q / len, x = n.x + drift * q + Math.sin(q * 0.35 + phase) * 0.35, y = n.y + q;
        if (y >= ground - 1) break;
        if (random() < t * t * 0.6 || pxKind(Math.floor(x), Math.floor(y)) === PK_BLOOM) continue;
        const idx = clamp(1 + t * 3.2 + rand(-0.7, 0.7), 0, 7) | 0;
        pxSet(x, y, F_P0 + idx, PK_BLOOM);
        if (random() < 0.3 * (1 - t)) pxSet(x + (random() < 0.5 ? -1 : 1), y, F_P0 + Math.min(idx + 1, 7), PK_BLOOM);
        if (random() < 0.05) sources.push([x, y]);
      }
    }

  // ---- SVG: one path per tone, horizontal runs ----
  const tones = [null, ...RAMP, TRUNK_D, TRUNK_M, TRUNK_L, GRASS, mix(BG_BOT, GRASS, 0.65), mix(BG_BOT, GRASS, 0.35)];
  const paths = tones.map(() => "");
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; ) {
      const v = pix[y * pw + x];
      let e = x + 1;
      while (e < pw && pix[y * pw + e] === v) e++;
      if (v) paths[v] += `M${x} ${y}h${e - x}v1h${x - e}z`;
      x = e;
    }
  // crop the empty sky above the crown so the image is only as tall as the tree
  let top = 0;
  while (top < ph - 3 && !pkind.subarray(top * pw, (top + 1) * pw).some((k) => k === PK_WOOD || k === PK_BLOOM)) top++;
  top = Math.max(0, top - 8);
  const W = pw * PX, H = (ph - top) * PX, Y0 = top * PX;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${Y0} ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">`;
  svg += `<style>.s{animation:s ease-in-out infinite alternate}.p{animation:f linear infinite;transform-box:fill-box;transform-origin:center}`;
  svg += `@keyframes s{from{transform:translateX(-10px)}to{transform:translateX(10px)}}`;
  svg += `@keyframes f{0%{transform:translate(0,0) rotate(0);opacity:0}8%{opacity:1}85%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}`;
  svg += `@media(prefers-reduced-motion:reduce){.s,.p{animation:none}}</style>`;
  svg += `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOT}"/></linearGradient></defs>`;
  svg += `<rect y="${Y0}" width="${W}" height="${H}" rx="10" fill="url(#bg)"/>`;
  svg += `<g transform="scale(${PX})">`;
  paths.forEach((d, i) => { if (d) svg += `<path fill="${tones[i]}" d="${d}"/>`; });
  svg += `</g>`;
  // falling petals, one per recent contribution; pixel petal shapes 2-3 tree-pixels wide
  const SHAPES = ["h2v1h-1v1h-1z", "h1v1h1v1h-2z", "h2v2h-1v-1h-1z", "h3v1h-1v1h-1v-1h-1z"];
  const colors = T.idle ? ["#b08aa6", "#9c7a8e", "#a8703c"] : RAMP.slice(0, 5);
  for (let i = 0; i < T.petals; i++) {
    const [sx, sy] = sources.length && random() < 0.85 ? sources[(random() * sources.length) | 0] : [random() * pw, top + random() * 20];
    const x = (sx + rand(-1, 1)) * PX, y = sy * PX;
    const dur = rand(7, 14), dy = (ground - sy) * PX;
    const d = `M${x | 0} ${y | 0}` + SHAPES[(random() * SHAPES.length) | 0].replace(/-?\d+/g, (n) => n * PX);
    svg += `<g class="s" style="animation-duration:${rand(1.5, 3).toFixed(1)}s"><path class="p" d="${d}" fill="${colors[(random() * colors.length) | 0]}" style="--dx:${rand(20, 90) | 0}px;--dy:${dy | 0}px;--r:${(rand(-1, 1) * 540) | 0}deg;animation-duration:${dur.toFixed(1)}s;animation-delay:-${rand(0, dur).toFixed(1)}s"/></g>`;
  }
  return svg + `</svg>`;
}

const main = process.argv[1]?.endsWith("sakura.mjs");
if (main) {
  const [a, b] = process.argv.slice(2);
  let days, login;
  if (a === "--demo") {
    login = "demo";
    days = Array.from({ length: 365 }, (_, i) => ({ count: i > 350 ? 3 : i % 3 }));
  } else {
    login = a || "katniis";
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is required");
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount}}}}}}`,
        variables: { l: login },
      }),
    });
    const json = await res.json();
    const weeks = json.data?.user?.contributionsCollection.contributionCalendar.weeks;
    if (!weeks) throw new Error("GraphQL failed: " + JSON.stringify(json));
    days = weeks.flatMap((w) => w.contributionDays).map((d) => ({ count: d.contributionCount }));
  }
  const out = b || "sakura.svg";
  // the tree's shape is seeded by your username, so only contributions change it
  writeFileSync(out, render(days, login));
  console.log(`wrote ${out}`, JSON.stringify(traits(days)));
}
