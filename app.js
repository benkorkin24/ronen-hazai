"use strict";

const DATA_URL = "data/forecast.json";
const DAYS = 5;
const $ = (id) => document.getElementById(id);

let DB = null;          // contents of data/forecast.json
let LOCS = [];          // [{id, n, lat, lon, r, d, key}]
let current = null;     // {loc, days, alerts, notes, via}

/* ---------- helpers ---------- */
const norm = (s) => (s || "").toLowerCase()
  .replace(/[֑-ׇ]/g, "")           // niqqud
  .replace(/["'״׳`\-–,.()]/g, " ")
  .replace(/\s+/g, " ").trim();

const fmt = (v, d = 0) => (v == null || Number.isNaN(v)) ? "—" : Number(v).toFixed(d);

function dayName(iso) {
  const d = new Date(iso + "T12:00:00");
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((d - today) / 864e5);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return d.toLocaleDateString("he-IL", { weekday: "long" });
}
const onDay = (iso) => { const n = dayName(iso); return n === "היום" || n === "מחר" ? n : "ב" + n; };
const shortDate = (iso) => { const [, m, d] = iso.split("-"); return `${+d}.${+m}`; };

function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const nearest = (pt) => LOCS.reduce((best, l) => {
  const dist = km(pt, l);
  return dist < best.dist ? { loc: l, dist } : best;
}, { loc: null, dist: Infinity });

function setStatus(msg, isErr) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}

function updatedText() {
  const [d, t] = DB.updated.split(" ");
  return `${shortDate(d)} בשעה ${t}`;
}

const WIND_DIRS = ["צפונית", "צפון-מזרחית", "מזרחית", "דרום-מזרחית", "דרומית", "דרום-מערבית", "מערבית", "צפון-מערבית"];
const windDir = (deg) => deg == null ? "" : WIND_DIRS[Math.round(deg / 45) % 8];

// PM10 (µg/m³), hourly peak of the day
function airQuality(pm) {
  if (pm == null) return null;
  if (pm <= 100) return { label: "טובה", cls: "aq-good" };
  if (pm <= 200) return { label: "בינונית", cls: "aq-mid" };
  if (pm <= 400) return { label: "לא בריאה", cls: "aq-bad" };
  return { label: "מסוכנת", cls: "aq-severe" };
}

const hh = (h) => String(h).padStart(2, "0") + ":00";
const rainHours = (wet) => !wet ? "" : wet[0] === wet[1] ? `סביב ${hh(wet[0])}` : `${hh(wet[0])}–${hh(Math.min(wet[1] + 1, 24))}`;

// sunrise / sunset (standard NOAA approximation, accurate to about a minute)
function sunTimes(iso, lat, lon) {
  const rad = Math.PI / 180, lw = -lon * rad, phi = lat * rad;
  const d = new Date(iso + "T12:00:00Z") / 864e5 - 0.5 + 2440588 - 2451545;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const jNoon = 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const jSet = 2451545 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);
  const t = (j) => new Date((j + 0.5 - 2440588) * 864e5)
    .toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });
  return { rise: t(jRise), set: t(jSet) };
}

// every Excel file and share is named "קובץ נתוני מזג אוויר לתאריך DD.MM.YYYY"
function fileTitle() {
  const [y, m, d] = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" }).split("-");
  return `קובץ נתוני מזג אוויר לתאריך ${d}.${m}.${y}`;
}

/* ---------- weather icons (by IMS weather code) ---------- */
const ICON_GROUP = {
  1250: "sun", 1310: "sun", 1580: "sun", 1270: "sun",
  1220: "part", 1530: "partrain",
  1230: "cloud", 1540: "rain", 1560: "rain", 1140: "rain",
  1020: "storm", 1510: "storm", 1260: "wind",
  1570: "dust", 1010: "dust", 1160: "fog",
  1320: "cold", 1590: "cold", 1300: "cold",
  1080: "snow", 1070: "snow", 1060: "snow", 1520: "snow",
};
const SUN = '<circle cx="16" cy="16" r="6" fill="#E8B90C"/><g stroke="#E8B90C" stroke-width="2.2" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g>';
const CLOUD = (x = 0, y = 0, c = "#8A97A3") => `<path transform="translate(${x} ${y})" d="M9 26h15a6 6 0 0 0 .6-12A8 8 0 0 0 9.3 16 5 5 0 0 0 9 26z" fill="${c}"/>`;
const DROPS = '<g stroke="#24557A" stroke-width="2.2" stroke-linecap="round"><path d="M12 28l-1.5 3M18 28l-1.5 3M24 28l-1.5 3"/></g>';
const ICONS = {
  sun: SUN,
  part: '<g transform="translate(-4 -5) scale(.8)">' + SUN + "</g>" + CLOUD(2, 2),
  partrain: '<g transform="translate(-4 -6) scale(.8)">' + SUN + "</g>" + CLOUD(2, -1) + DROPS,
  cloud: CLOUD(0, 0),
  rain: CLOUD(0, -3, "#6B7884") + DROPS,
  storm: CLOUD(0, -4, "#3E4A55") + '<path d="M17 21l-4 6h4l-2 5 6-8h-4l2-3z" fill="#E8B90C"/>',
  wind: '<g stroke="#55616C" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M4 12h16a4 4 0 1 0-4-4"/><path d="M4 18h22a4 4 0 1 1-4 4"/><path d="M4 24h10"/></g>',
  dust: '<g fill="#B08B5B"><circle cx="8" cy="10" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="24" cy="11" r="2"/><circle cx="11" cy="17" r="2"/><circle cx="20" cy="16" r="2"/><circle cx="7" cy="24" r="2"/><circle cx="16" cy="24" r="2"/><circle cx="25" cy="22" r="2"/></g>',
  fog: '<g stroke="#8A97A3" stroke-width="2.6" stroke-linecap="round"><path d="M5 11h22M3 17h26M7 23h18"/></g>',
  cold: '<g stroke="#24557A" stroke-width="2.2" stroke-linecap="round"><path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12"/></g>',
  snow: CLOUD(0, -4, "#8A97A3") + '<g fill="#24557A"><circle cx="11" cy="28" r="1.8"/><circle cx="17" cy="30" r="1.8"/><circle cx="23" cy="28" r="1.8"/></g>',
};
const icon = (code) => `<svg viewBox="0 0 32 32" aria-hidden="true">${ICONS[ICON_GROUP[code]] || ICONS.cloud}</svg>`;

const ALERT_ICO = (color) => `<svg class="alert-ico" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 3L26 24H2z" fill="${color}"/><path d="M14 10v7" stroke="#1B2229" stroke-width="2.4" stroke-linecap="round"/><circle cx="14" cy="20.5" r="1.5" fill="#1B2229"/></svg>`;
const NOTE_ICO = '<svg class="alert-ico" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#24557A"/><path d="M14 12.5v7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="14" cy="8.5" r="1.6" fill="#fff"/></svg>';

/* ---------- data ---------- */
async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  DB = await res.json();
  LOCS = Object.entries(DB.locations).map(([id, l]) => ({ id, ...l, key: norm(l.n) }));
  LOCS.sort((a, b) => a.n.localeCompare(b.n, "he"));
}

function matchLocal(q) {
  const k = norm(q);
  if (!k) return [];
  const exact = LOCS.filter((l) => l.key === k);
  const starts = LOCS.filter((l) => l.key !== k && l.key.startsWith(k));
  const word = LOCS.filter((l) => !l.key.startsWith(k) && l.key.split(" ").some((w) => w.startsWith(k)));
  const inc = LOCS.filter((l) => !l.key.startsWith(k) && !word.includes(l) && l.key.includes(k));
  return [...exact, ...starts, ...word, ...inc];
}

// Place search across all of Israel, in order: OpenStreetMap (Nominatim) → Photon → Open-Meteo.
// Returns up to 5 candidates [{name, label, lat, lon}].
const IL_BOX = { w: 34.2, s: 29.4, e: 35.95, n: 33.4 };
const inIsrael = (p) => p.lat >= IL_BOX.s && p.lat <= IL_BOX.n && p.lon >= IL_BOX.w && p.lon <= IL_BOX.e;

/* ---------- IDF bases (bases.js) ---------- */
const BASE_PREFIX = /^(בסיס חיל האוויר|בסיס חיל האויר|בסיס|מחנה|בחא)\s+/;
const baseKey = (s) => norm((s || "").replace(/["'״׳`]/g, ""));
function matchBase(q) {
  const clean = (q || "").replace(/["'״׳`]/g, "").trim();
  const hadPrefix = BASE_PREFIX.test(clean);
  const full = baseKey(clean), bare = baseKey(clean.replace(BASE_PREFIX, ""));
  return BASES.find((b) => baseKey(b.label) === full || b.names.some((n) => {
    const k = baseKey(n);
    return (k === full || k === bare) && (hadPrefix || !b.prefixOnly);
  })) || null;
}
function suggestBases(q) {
  const k = baseKey(q);
  if (k.length < 2) return [];
  return BASES.filter((b) => [b.label, ...b.names].some((n) => baseKey(n).startsWith(k)));
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

const GEOCODERS = [
  async (q) => (await getJSON("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=il,ps"
      + "&accept-language=he&q=" + encodeURIComponent(q)))
    .map((x) => ({ name: x.name || x.display_name.split(",")[0], label: x.display_name.split(",").slice(0, 3).join(","),
      lat: +x.lat, lon: +x.lon })),
  async (q) => (await getJSON(`https://photon.komoot.io/api/?limit=6&bbox=${IL_BOX.w},${IL_BOX.s},${IL_BOX.e},${IL_BOX.n}&q=`
      + encodeURIComponent(q))).features
    .map((f) => ({ name: f.properties.name, label: [f.properties.name, f.properties.city || f.properties.state].filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })),
  async (q) => ((await getJSON("https://geocoding-api.open-meteo.com/v1/search?count=5&language=he&format=json&countryCode=IL&name="
      + encodeURIComponent(q))).results || [])
    .map((x) => ({ name: x.name, label: [x.name, x.admin1].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude })),
];

async function geocode(q) {
  q = q.trim();
  // "קיבוץ סאסא" → also try "סאסא"
  const stripped = q.replace(/^(קיבוץ|מושב|מושבה|יישוב|ישוב|העיר|עיר)\s+/, "");
  const variants = stripped !== q ? [q, stripped] : [q];
  let reachedAny = false;
  for (const v of variants) {
    for (const g of GEOCODERS) {
      try {
        const hits = (await g(v)).filter((h) => h.name && inIsrael(h));
        reachedAny = true;
        // drop near-duplicates (same place mapped several times)
        const uniq = [];
        for (const h of hits) if (!uniq.some((u) => km(u, h) < 3)) uniq.push(h);
        if (uniq.length) return uniq.slice(0, 5);
      } catch (e) { /* try the next service */ }
    }
  }
  if (!reachedAny) throw new Error("offline");
  return [];
}

/* ---------- safety ---------- */
function alertColor(text) {
  if (/אדומ/.test(text)) return "red";
  if (/כתומ/.test(text)) return "orange";
  return "yellow";
}
// IMS texts often repeat the same sentence; keep each sentence once
const dedupe = (t) => [...new Set(t.split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean))].join(" ");

const COLOR_HEX = { yellow: "#E8B90C", orange: "#E07A10", red: "#C0281F" };

function officialAlerts(loc) {
  // the data file is refreshed every 2 hours, so drop warnings that expired since
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 16);
  return (DB.warnings || [])
    .filter((w) => !w.to || w.to.slice(0, 16) > now)
    .filter((w) => w.regions.includes(String(loc.r)) || w.regions.length === 0)
    .sort((a, b) => (a.from || "").localeCompare(b.from || ""))
    .map((w) => {
      const color = alertColor(w.he);
      const kind = /מוקדמת/.test(w.he) ? "התראה מוקדמת" : "אזהרה";
      return {
        color, kind,
        text: dedupe(w.he.replace(/^עדכון:\s*/, "") + (w.txt && !w.he.includes(w.txt) ? ". " + w.txt : "")),
        from: w.from, to: w.to,
      };
    });
}

function derivedNotes(days) {
  // same note on several days is listed once, with all its days
  const byText = new Map();
  const add = (iso, text) => {
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(dayName(iso));
  };
  for (const [iso, d] of days) {
    const g = ICON_GROUP[d.c];
    if (g === "storm") add(iso, "צפויות סופות רעמים: להימנע משהייה בשטח פתוח, בחופים ובמים.");
    if (d.rm != null && d.rm >= 20) add(iso, `גשם כבד (כ-${fmt(d.rm)} מ״מ): סכנת הצפות ושטפונות. לא לחצות נחלים או כבישים מוצפים.`);
    if (d.g != null && d.g >= 60) add(iso, `משבי רוח עד ${fmt(d.g)} קמ״ש: לקשור חפצים במרפסות ולהיזהר מעצים ומפיגומים.`);
    if (d.hs != null && d.hs >= 2) add(iso, "עומס חום: להרבות בשתייה ולהימנע ממאמץ בשעות הצהריים.");
    if (g === "dust") add(iso, "אובך או סופת חול: מומלץ לאוכלוסייה רגישה להישאר בבית.");
    if (g === "snow" || d.c === "1300") add(iso, "שלג או קרה: כבישים עלולים להיות חלקלקים. לפני נסיעה לבדוק את מצב הכבישים.");
    if (d.uv != null && d.uv >= 8) add(iso, "קרינת UV גבוהה מאוד: צל, כובע ומקדם הגנה בין 10:00 ל-16:00.");
  }
  return [...byText].map(([text, ds]) => ({ day: ds.join(", "), text }));
}

/* ---------- executive brief ---------- */
const RISK = [
  { label: "נמוכה", cls: "risk-0", text: "אין התרעות, ואין בתחזית תנאים שמחייבים היערכות." },
  { label: "מוגברת", cls: "risk-1", text: "יש תנאים שכדאי לקחת בחשבון בתכנון." },
  { label: "גבוהה", cls: "risk-2", text: "צפויים תנאים שמחייבים היערכות." },
  { label: "חמורה", cls: "risk-3", text: "צפויים תנאים מסוכנים. יש לפעול לפי הנחיות הרשויות." },
];
function riskLevel(alerts, days) {
  let r = 0;
  for (const a of alerts) r = Math.max(r, a.color === "red" ? 3 : a.color === "orange" ? 2 : 1);
  for (const [, d] of days) {
    const g = ICON_GROUP[d.c];
    if (g === "storm" || (d.rm ?? 0) >= 20 || (d.g ?? 0) >= 60 || (d.hs ?? 0) >= 3 || (d.pm ?? 0) > 400) r = Math.max(r, 2);
    if ((d.hs ?? 0) >= 4 || (d.g ?? 0) >= 90 || (d.rm ?? 0) >= 50) r = 3;
    if (g === "dust" || g === "snow" || (d.uv ?? 0) >= 8 || (d.hs ?? 0) >= 2 || (d.g ?? 0) >= 45 || (d.rc ?? 0) >= 60) r = Math.max(r, 1);
  }
  return r;
}

function briefSummary(days) {
  const wetDays = days.filter(([, d]) => (d.rc ?? 0) >= 40 || (d.rm ?? 0) >= 1);
  const mx = Math.max(...days.map(([, d]) => d.mx ?? -99)), mn = Math.min(...days.map(([, d]) => d.mn ?? 99));
  const parts = [];
  parts.push(wetDays.length
    ? `צפוי גשם ב${wetDays.length === 1 ? "יום אחד" : "-" + wetDays.length + " ימים"} מתוך 5 (${wetDays.map(([iso]) => dayName(iso)).join(", ")}).`
    : "לא צפוי גשם משמעותי ב-5 הימים הקרובים.");
  parts.push(`הטמפרטורות ינועו בין ${fmt(mn)} ל-${fmt(mx)} מעלות.`);
  const windy = days.reduce((b, x) => ((x[1].g ?? 0) > (b[1].g ?? 0) ? x : b));
  if ((windy[1].g ?? 0) >= 40) parts.push(`משבי הרוח החזקים ביותר צפויים ${onDay(windy[0])}, עד ${fmt(windy[1].g)} קמ״ש.`);
  return parts.join(" ");
}

function renderBrief(loc, days, alerts) {
  const r = RISK[riskLevel(alerts, days)];
  const wettest = days.reduce((b, x) => ((x[1].rc ?? -1) > (b[1].rc ?? -1) ? x : b));
  const windy = days.reduce((b, x) => ((x[1].g ?? -1) > (b[1].g ?? -1) ? x : b));
  const worstAir = days.reduce((b, x) => ((x[1].pm ?? -1) > (b[1].pm ?? -1) ? x : b));
  const mx = Math.max(...days.map(([, d]) => d.mx ?? -99)), mn = Math.min(...days.map(([, d]) => d.mn ?? 99));
  const sun = sunTimes(days[0][0], loc.lat, loc.lon);
  const aq = airQuality(worstAir[1].pm);
  const waves = loc.coast ? Math.max(...days.map(([, d]) => d.wv ?? 0)) : 0;

  const facts = [
    ["טווח טמפרטורות", `${fmt(mn)}°–${fmt(mx)}°`, "", "ltr"],
    ["הסיכוי הגבוה לגשם", (wettest[1].rc ?? 0) > 0 ? `${Math.round(wettest[1].rc)}%` : "0%", (wettest[1].rc ?? 0) > 0 ? dayName(wettest[0]) : "בכל הימים"],
    ["משב הרוח החזק", `${fmt(windy[1].g)} קמ״ש`, dayName(windy[0])],
    ["איכות אוויר", aq ? aq.label : "—", aq && aq.label !== "טובה" ? dayName(worstAir[0]) : ""],
    waves ? ["גובה גלים מרבי", `${waves.toFixed(1)} מ׳`, ""] : null,
    ["זריחה ושקיעה היום", `${sun.rise} / ${sun.set}`, "", "ltr"],
  ].filter(Boolean);

  const el = $("brief");
  el.className = "brief " + r.cls;
  el.innerHTML = `
    <div class="brief-verdict">
      <span class="risk-mark" aria-hidden="true"></span>
      <div>
        <div class="risk-label">רמת סיכון: <strong></strong></div>
        <p class="brief-text"></p>
      </div>
    </div>
    <dl class="facts"></dl>`;
  el.querySelector(".risk-label strong").textContent = r.label;
  el.querySelector(".brief-text").textContent = briefSummary(days) + " " + r.text;
  const dl = el.querySelector(".facts");
  for (const [k, v, sub, dir] of facts) {
    const div = document.createElement("div");
    div.innerHTML = "<dt></dt><dd><span class='fv'></span><span class='fs'></span></dd>";
    div.querySelector("dt").textContent = k;
    div.querySelector(".fv").textContent = v;
    if (dir) div.querySelector(".fv").dir = dir;
    div.querySelector(".fs").textContent = sub;
    dl.appendChild(div);
  }
}

/* ---------- 5-day chart: temperature (line) above rain chance (bars), shared time axis ---------- */
let chartDays = null;
function renderChart(days) {
  chartDays = days;
  const body = $("chartBody");
  const pts = [];
  days.forEach(([iso, d], di) => (d.s || []).forEach(([h, t, rc, w]) => pts.push({ iso, di, h, t, rc, w })));
  if (pts.length < 4) { $("chart").hidden = true; return; }
  $("chart").hidden = false;

  const W = Math.max(body.clientWidth, 300), padS = 34, padE = 8;
  const H1 = 150, H2 = 70, gap = 26, top = 24, H = top + H1 + gap + H2 + 22;
  const slots = days.length * 8;                       // 3-hour slots
  const slotW = (W - padS - padE) / slots;
  // right-to-left: the first slot sits at the right edge, like the table
  const x = (di, h) => W - padE - (di * 8 + h / 3 + 0.5) * slotW;
  const temps = pts.map((p) => p.t).filter((v) => v != null);
  let lo = Math.floor(Math.min(...temps) / 5) * 5, hi = Math.ceil(Math.max(...temps) / 5) * 5;
  if (hi - lo < 10) hi = lo + 10;
  const yT = (v) => top + H1 - ((v - lo) / (hi - lo)) * H1;
  const y0R = top + H1 + gap + H2, yR = (v) => y0R - (v / 100) * H2;

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף טמפרטורה וסיכוי לגשם ל-5 ימים">`;
  // gridlines + axis labels (left edge = the far end of the period in RTL, so labels sit on the left)
  for (let v = lo; v <= hi; v += 5) {
    svg += `<line class="grid" x1="${padS}" x2="${W - padE}" y1="${yT(v)}" y2="${yT(v)}"/><text class="ax" x="${padS - 6}" y="${yT(v) + 4}" text-anchor="end">${v}°</text>`;
  }
  for (const v of [0, 50, 100]) {
    svg += `<line class="grid" x1="${padS}" x2="${W - padE}" y1="${yR(v)}" y2="${yR(v)}"/><text class="ax" x="${padS - 6}" y="${yR(v) + 4}" text-anchor="end">${v}%</text>`;
  }
  svg += `<text class="panel" x="${W - padE}" y="${top + H1 + gap - 8}" text-anchor="start">סיכוי לגשם</text>`;
  // day separators + day names
  days.forEach(([iso], di) => {
    const xr = W - padE - di * 8 * slotW;
    if (di > 0) svg += `<line class="daysep" x1="${xr}" x2="${xr}" y1="${top - 18}" y2="${y0R}"/>`;
    const nm = dayName(iso), narrow = slotW * 8 < 80 && nm.startsWith("יום ");
    const label = narrow ? new Date(iso + "T12:00:00").toLocaleDateString("he-IL", { weekday: "narrow" }) : nm;
    svg += `<text class="dayl" x="${xr - 4 * slotW}" y="${top - 8}" text-anchor="middle">${label}</text>`;
  });
  // rain bars
  for (const p of pts) {
    if (!p.rc) continue;
    const bw = Math.max(slotW - 2, 1), bx = x(p.di, p.h) - bw / 2, by = yR(p.rc);
    svg += `<rect class="rbar" x="${bx}" y="${by}" width="${bw}" height="${y0R - by}" rx="${Math.min(2, bw / 2)}"/>`;
  }
  // temperature line
  const line = pts.filter((p) => p.t != null).map((p, i) => `${i ? "L" : "M"}${x(p.di, p.h).toFixed(1)},${yT(p.t).toFixed(1)}`).join("");
  svg += `<path class="tline" d="${line}"/>`;
  // label each day's peak only
  days.forEach(([iso, d], di) => {
    const dp = pts.filter((p) => p.di === di && p.t != null);
    if (!dp.length) return;
    const pk = dp.reduce((a, b) => (b.t > a.t ? b : a));
    svg += `<circle class="tdot" cx="${x(di, pk.h)}" cy="${yT(pk.t)}" r="4"/><text class="tlab" x="${x(di, pk.h)}" y="${yT(pk.t) - 9}" text-anchor="middle">${Math.round(pk.t)}°</text>`;
  });
  svg += `<line class="cross" id="cross" x1="0" x2="0" y1="${top - 4}" y2="${y0R}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${padS}" y="0" width="${W - padS}" height="${H}"/></svg>`;
  body.innerHTML = svg;

  const tip = $("chartTip"), cross = body.querySelector("#cross"), hit = body.querySelector(".hit");
  const move = (ev) => {
    const r = body.getBoundingClientRect();
    const px = ev.clientX - r.left;
    let best = null, bd = Infinity;
    for (const p of pts) { const dd = Math.abs(x(p.di, p.h) - px); if (dd < bd) { bd = dd; best = p; } }
    if (!best) return;
    const cx = x(best.di, best.h);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<strong>${dayName(best.iso)} ${hh(best.h)}</strong><span>${best.t == null ? "—" : best.t.toFixed(1) + "°"}</span><span>גשם ${best.rc == null ? "—" : Math.round(best.rc) + "%"}</span><span>רוח ${fmt(best.w)} קמ״ש</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(cx - tw / 2, 0), W - tw) + "px";
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}
let chartResize;
addEventListener("resize", () => { clearTimeout(chartResize); chartResize = setTimeout(() => chartDays && renderChart(chartDays), 150); });

/* ---------- render ---------- */
function show(loc, via) {
  const days = Object.entries(loc.d).sort(([a], [b]) => a.localeCompare(b)).slice(0, DAYS);
  current = { loc, days, alerts: officialAlerts(loc), notes: derivedNotes(days), via };

  $("place").textContent = loc.n;
  const viaTxt = via ? `תחזית לתחנה הקרובה ל${via.name} (${fmt(via.dist)} ק״מ). ` : "";
  $("meta").textContent = `${viaTxt}עודכן ב-${updatedText()}, לפי השירות המטאורולוגי הישראלי`;

  // alerts
  const al = $("alerts");
  al.innerHTML = "";
  if (!current.alerts.length) {
    al.innerHTML = '<div class="alerts-none"><strong>אין התרעות רשמיות לאזור זה.</strong></div>';
  }
  for (const a of current.alerts) {
    const el = document.createElement("div");
    el.className = "alert " + a.color;
    el.innerHTML = ALERT_ICO(COLOR_HEX[a.color]) + '<div class="alert-title"></div><div class="alert-body"></div>';
    el.querySelector(".alert-title").textContent = `${a.kind} (השירות המטאורולוגי)`;
    el.querySelector(".alert-body").textContent = a.text;
    al.appendChild(el);
  }
  if (current.notes.length) {
    const el = document.createElement("div");
    el.className = "alert note";
    el.innerHTML = NOTE_ICO + '<div class="alert-title">הערות בטיחות לפי נתוני התחזית</div><div class="alert-body"></div>';
    const body = el.querySelector(".alert-body");
    current.notes.forEach((n) => {
      const p = document.createElement("div");
      p.textContent = `${n.day} – ${n.text}`;
      body.appendChild(p);
    });
    al.appendChild(el);
  }

  renderBrief(loc, days, current.alerts);

  // table
  const tb = $("fcBody");
  tb.innerHTML = "";
  const coast = loc.coast && days.some(([, d]) => d.wv != null);
  $("fcTable").classList.toggle("no-wave", !coast);
  for (const [iso, d] of days) {
    const desc = DB.codes[d.c] || "";
    const rc = d.rc == null ? null : Math.round(d.rc);
    const uvCls = d.uv >= 8 ? "uv-xhi" : d.uv >= 6 ? "uv-hi" : "";
    const aq = airQuality(d.pm);
    const feels = d.fx != null && Math.abs(d.fx - d.mx) >= 2 ? `מורגש ${fmt(d.fx)}°` : "";
    const rainSub = [d.rm ? `${fmt(d.rm, 1)} מ״מ` : "", rainHours(d.wet)].filter(Boolean).join(" · ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="c-day"><div class="day-name">${dayName(iso)}</div><div class="day-date">${shortDate(iso)}</div></td>
      <td class="c-cond"><div class="cond">${icon(d.c)}<span>${desc}</span></div></td>
      <td class="c-temp"><div class="temps">${fmt(d.mx)}° <span>/ ${fmt(d.mn)}°</span></div>${feels ? `<div class="sub">${feels}</div>` : ""}</td>
      <td class="c-rain"><div class="rain"><span class="rain-pct">${rc == null ? "—" : rc + "%"}</span><div class="rain-bar" role="img" aria-label="סיכוי לגשם ${rc ?? 0}%"><i style="width:${rc || 0}%"></i></div></div>${rainSub ? `<div class="sub">${rainSub}</div>` : ""}</td>
      <td class="c-wind"><div class="wv">${fmt(d.w)} <span>/ ${fmt(d.g)}</span></div><div class="sub">${windDir(d.wd)}</div></td>
      <td class="c-uv num ${uvCls}">${fmt(d.uv)}</td>
      <td class="c-aq">${aq ? `<span class="aq ${aq.cls}">${aq.label}</span><div class="sub">${d.pm}</div>` : "—"}</td>
      <td class="c-wave num">${d.wv == null ? "—" : d.wv.toFixed(1)}</td>
      <td class="c-hum num">${d.h == null ? "—" : d.h + "%"}</td>
      <td class="c-extra">רוח ${windDir(d.wd)} ${fmt(d.w)} (משבים ${fmt(d.g)}) קמ״ש · UV ${fmt(d.uv)} · איכות אוויר ${aq ? aq.label : "—"}${coast && d.wv != null ? ` · גלים ${d.wv.toFixed(1)} מ׳` : ""} · לחות ${d.h == null ? "—" : d.h + "%"}${rainSub ? " · גשם " + rainSub : ""}</td>`;
    tb.appendChild(tr);
  }

  // national outlook for today
  const firstDay = days[0] && days[0][0];
  const nat = DB.country && DB.country[firstDay];
  const nowIL = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 16);
  const natCount = (DB.warnings || []).filter((w) => !w.to || w.to.slice(0, 16) > nowIL).length;
  $("national").innerHTML = '<h3>התחזית הארצית</h3><p class="nat-text"></p><p class="nat-count"></p>';
  $("national").querySelector(".nat-text").textContent = nat || "";
  $("national").querySelector(".nat-count").textContent = natCount
    ? `בתוקף כרגע ${natCount === 1 ? "התרעה אחת" : natCount + " התרעות"} של השירות המטאורולוגי ברחבי הארץ.`
    : "אין כרגע התרעות פעילות של השירות המטאורולוגי בשום אזור בארץ.";

  const rep = $("report");
  rep.hidden = false;
  rep.classList.remove("enter"); void rep.offsetWidth; rep.classList.add("enter");
  renderChart(days);   // after the report is visible, so the chart can measure its width
  setStatus("");
  try { localStorage.setItem("ronen-last", loc.id); } catch (e) {}
  history.replaceState(null, "", "#" + encodeURIComponent(loc.n));
}

/* ---------- search ---------- */
let searchSeq = 0;
async function search(q) {
  q = (q || "").trim();
  searchSeq++;
  $("alts").innerHTML = "";
  if (!q) { setStatus("הקלידו שם של יישוב או מקום.", true); return; }
  closeSuggest();
  const base = matchBase(q);
  if (base) { showPlace({ name: base.label, lat: base.lat, lon: base.lon }); return; }
  const local = matchLocal(q);
  if (local.length) { show(local[0]); scrollToReport(); return; }

  setStatus(`מחפש את "${q}" במפה…`);
  const token = ++searchSeq;
  let hits;
  try {
    hits = await geocode(q);
  } catch (e) {
    hits = null;
  }
  if (token !== searchSeq) return;   // a newer search started meanwhile
  if (!hits || !hits.length) {
    $("report").hidden = true;
    setStatus(hits ? `לא נמצא מקום בשם "${q}". נסו לכתוב את השם אחרת, למשל בלי קיצורים.`
      : "אין חיבור לאינטרנט לאיתור המקום. בחרו יישוב מהרשימה.", true);
    return;
  }
  showPlace(hits[0]);
  if (hits.length > 1) renderAlts(hits);
}

function showPlace(g) {
  const { loc, dist } = nearest(g);
  if (dist > 60) { $("report").hidden = true; setStatus(`"${g.name}" נמצא מחוץ לאזור התחזית של השירות המטאורולוגי הישראלי.`, true); return; }
  show(loc, { name: g.name, dist });
  scrollToReport();
}

function renderAlts(hits) {
  const box = $("alts");
  box.innerHTML = "<span>מקומות נוספים בשם הזה:</span>";
  hits.forEach((h, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = h.label || h.name;
    b.setAttribute("aria-pressed", i === 0);
    b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      showPlace(h);
    });
    box.appendChild(b);
  });
}
function scrollToReport() {
  $("report").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

let sugIdx = -1;
function renderSuggest() {
  const q = $("q").value;
  const list = $("suggest");
  const items = [...suggestBases(q).map((b) => ({ n: b.label })), ...matchLocal(q)].slice(0, 8);
  sugIdx = -1;
  list.innerHTML = "";
  if (!items.length || norm(q) === (items[0] && items[0].key) && items.length === 1) { closeSuggest(); return; }
  items.forEach((l, i) => {
    const li = document.createElement("li");
    li.role = "option"; li.id = "opt" + i; li.textContent = l.n;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); $("q").value = l.n; search(l.n); });
    list.appendChild(li);
  });
  list.hidden = false;
  $("q").setAttribute("aria-expanded", "true");
}
function closeSuggest() {
  $("suggest").hidden = true;
  $("q").setAttribute("aria-expanded", "false");
  $("q").removeAttribute("aria-activedescendant");
}
function moveSuggest(dir) {
  const opts = [...$("suggest").children];
  if (!opts.length || $("suggest").hidden) return;
  sugIdx = (sugIdx + dir + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute("aria-selected", i === sugIdx));
  $("q").setAttribute("aria-activedescendant", opts[sugIdx].id);
  $("q").value = opts[sugIdx].textContent;
}

/* ---------- excel ---------- */
const DAY_HEAD = ["תאריך", "יום", "מצב", "טמפ׳ מקסימלית (°C)", "טמפ׳ מינימלית (°C)", "טמפ׳ מורגשת מקסימלית (°C)",
  "סיכוי לגשם (%)", "כמות גשם (מ״מ)", "שעות גשם צפויות", "רוח (קמ״ש)", "משבים (קמ״ש)", "כיוון רוח",
  "UV", "איכות אוויר", "PM10 (מק״ג/מ״ק)", "גובה גלים (מ׳)", "לחות ממוצעת (%)", "זריחה", "שקיעה"];
function dayRow(loc, iso, d) {
  const aq = airQuality(d.pm), sun = sunTimes(iso, loc.lat, loc.lon);
  return [iso.split("-").reverse().join("/"), dayName(iso), DB.codes[d.c] || "",
    d.mx, d.mn, d.fx, d.rc == null ? null : Math.round(d.rc), d.rm, rainHours(d.wet) || "—",
    d.w, d.g, windDir(d.wd), d.uv, aq ? aq.label : "", d.pm, d.wv, d.h, sun.rise, sun.set];
}
const DAY_COLS = [12, 11, 20, 11, 11, 12, 10, 10, 15, 9, 9, 13, 5, 11, 11, 10, 11, 8, 8];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The file is built on the device itself; nothing is uploaded anywhere.
// Android and computers: a regular download into the Downloads folder.
// iPhone/iPad: Safari, and especially an app added to the home screen, ignore download links,
// so the file goes to the iOS sheet where "Save to Files" stores it on the phone.
async function saveWorkbook(wb, title) {
  const name = title + ".xlsx";
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const file = new File([data], name, { type: XLSX_MIME });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: title });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      // otherwise fall through to a regular download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}

function exportExcel() {
  if (!current) return;
  if (!window.XLSX) { setStatus("רכיב הייצוא לאקסל עוד לא נטען. נסו שוב בעוד רגע.", true); return; }
  const { loc, days, alerts, notes, via } = current;
  const title = fileTitle();
  const risk = RISK[riskLevel(alerts, days)];
  const rows = [
    [title],
    ["מקום", via ? `${via.name} (תחזית מתחנת ${loc.n}, ${fmt(via.dist)} ק״מ)` : loc.n],
    ["רמת סיכון", risk.label],
    ["תמונת מצב", briefSummary(days) + " " + risk.text],
    ["עדכון אחרון של הנתונים", DB.updated],
    ["מקור", DB.source],
    [],
    DAY_HEAD,
    ...days.map(([iso, d]) => dayRow(loc, iso, d)),
    [],
    ["התרעות רשמיות"],
    ...(alerts.length ? alerts.map((a) => [a.kind, a.text]) : [["", "אין התרעות רשמיות לאזור זה"]]),
  ];
  if (notes.length) {
    rows.push([], ["הערות בטיחות לפי נתוני התחזית"], ...notes.map((n) => [n.day, n.text]));
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = DAY_COLS.map((w, i) => ({ wch: i === 0 ? 22 : w }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 3, c: 1 }, e: { r: 3, c: 12 } }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "תחזית");
  saveWorkbook(wb, title);
}

/* ---------- unified export (up to 15 places) ---------- */
const MULTI_MAX = 15;
let multi = [];   // [{query, label, loc, via}]

// Same order as the main search: IDF base → IMS location → map search (first hit).
async function resolvePlace(q) {
  const base = matchBase(q);
  if (base) return fromPoint({ name: base.label, lat: base.lat, lon: base.lon });
  const local = matchLocal(q);
  if (local.length) return { label: local[0].n, loc: local[0], via: null };
  const hits = await geocode(q);
  if (!hits.length) throw new Error(`לא נמצא מקום בשם "${q}".`);
  return fromPoint(hits[0]);
}
function fromPoint(g) {
  const { loc, dist } = nearest(g);
  if (dist > 60) throw new Error(`"${g.name}" נמצא מחוץ לאזור התחזית של השירות המטאורולוגי הישראלי.`);
  return { label: g.name, loc, via: dist > 1 ? { name: g.name, dist } : null };
}

function multiMsg(text, isErr) {
  $("multiMsg").textContent = text || "";
  $("multiMsg").classList.toggle("err", !!isErr);
}

function renderMulti() {
  const list = $("multiList");
  list.innerHTML = "";
  multi.forEach((m, i) => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="m-name"></span><span class="m-st"></span><button type="button" class="m-rm">הסרה</button>';
    li.querySelector(".m-name").textContent = m.label;
    li.querySelector(".m-st").textContent = m.via
      ? `תחזית מתחנת ${m.loc.n}, ${fmt(m.via.dist)} ק״מ`
      : "תחנה של השירות המטאורולוגי";
    li.querySelector(".m-rm").setAttribute("aria-label", "הסרת " + m.label);
    li.querySelector(".m-rm").addEventListener("click", () => {
      multi.splice(i, 1);
      multiMsg("");
      renderMulti();
    });
    list.appendChild(li);
  });
  $("multiCount").textContent = `${multi.length} מתוך ${MULTI_MAX}`;
  $("multiExport").disabled = !multi.length;
  const full = multi.length >= MULTI_MAX;
  $("multiQ").disabled = full;
  $("multiForm").querySelector("button").disabled = full;
  if (full) $("multiQ").value = "";
  if (full) multiMsg("הגעתם ל-15 מקומות. כדי להוסיף מקום אחר, הסירו אחד מהרשימה.");
}

async function addMulti(q) {
  q = (q || "").trim();
  if (!q) return;
  if (multi.length >= MULTI_MAX) return;
  if (multi.some((m) => norm(m.label) === norm(q))) { multiMsg(`"${q}" כבר ברשימה.`, true); return; }
  multiMsg(`מחפש את "${q}"…`);
  try {
    const r = await resolvePlace(q);
    if (multi.some((m) => m.label === r.label)) { multiMsg(`"${r.label}" כבר ברשימה.`, true); return; }
    multi.push({ query: q, ...r });
    $("multiQ").value = "";
    multiMsg(`נוסף: ${r.label}`);
    renderMulti();
  } catch (e) {
    multiMsg(e.message === "offline" ? "אין חיבור לאינטרנט לאיתור המקום." : e.message + " נסו לכתוב את השם אחרת.", true);
  }
  $("multiQ").focus();
}

function openMulti() {
  if (!$("placeList").children.length) {
    const opts = [...BASES.map((b) => b.label), ...LOCS.map((l) => l.n)];
    $("placeList").innerHTML = opts.map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
  }
  // start from the place on screen
  if (!multi.length && current) {
    multi.push(current.via
      ? { label: current.via.name, loc: current.loc, via: current.via }
      : { label: current.loc.n, loc: current.loc, via: null });
  }
  multiMsg("");
  renderMulti();
  $("multi").showModal();
  if (!$("multiQ").disabled) $("multiQ").focus();
}

function exportMulti() {
  if (!multi.length) return;
  if (!window.XLSX) { multiMsg("רכיב הייצוא לאקסל עוד לא נטען. נסו שוב בעוד רגע.", true); return; }
  const title = fileTitle();
  const head = ["מקום", "תחנת השירות המטאורולוגי", "מרחק מהתחנה (ק״מ)", "רמת סיכון", ...DAY_HEAD, "התרעות רשמיות פעילות"];
  const rows = [
    [title],
    ["מקומות", multi.length],
    ["עדכון אחרון של הנתונים", DB.updated],
    ["מקור", DB.source],
    [],
    head,
  ];
  const alertRows = [["מקום", "תחנה", "סוג", "פירוט"]];
  for (const m of multi) {
    const days = Object.entries(m.loc.d).sort(([a], [b]) => a.localeCompare(b)).slice(0, DAYS);
    const alerts = officialAlerts(m.loc);
    const notes = derivedNotes(days);
    const risk = RISK[riskLevel(alerts, days)].label;
    for (const [iso, d] of days) {
      rows.push([m.label, m.loc.n, m.via ? Math.round(m.via.dist) : 0, risk, ...dayRow(m.loc, iso, d),
        alerts.length ? `${alerts.length} (ראו גיליון התרעות)` : "אין"]);
    }
    if (!alerts.length && !notes.length) alertRows.push([m.label, m.loc.n, "", "אין התרעות רשמיות לאזור זה"]);
    alerts.forEach((a) => alertRows.push([m.label, m.loc.n, `${a.kind} (השירות המטאורולוגי)`, a.text]));
    notes.forEach((n) => alertRows.push([m.label, m.loc.n, "הערת בטיחות לפי התחזית", `${n.day} – ${n.text}`]));
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [24, 20, 10, 10, ...DAY_COLS, 22].map((w) => ({ wch: w }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: rows.length - 1, c: head.length - 1 } }) };
  const ws2 = XLSX.utils.aoa_to_sheet(alertRows);
  ws2["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 28 }, { wch: 110 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "תחזית אחודה");
  XLSX.utils.book_append_sheet(wb, ws2, "התרעות ובטיחות");
  const count = multi.length === 1 ? "מקום אחד" : `${multi.length} מקומות`;
  saveWorkbook(wb, title).then((how) => {
    if (how === "shared") multiMsg(`הקובץ האחוד מוכן, עם ${count}. כדי לשמור בטלפון בחרו "שמירה בקבצים".`);
    else if (how === "downloaded") multiMsg(`הקובץ האחוד ירד לתיקיית ההורדות, עם ${count}.`);
    else multiMsg("השמירה בוטלה. אפשר ללחוץ שוב על הורדת הקובץ.");
  });
}

/* ---------- geolocation ---------- */
function useMyLocation() {
  if (!navigator.geolocation) { setStatus("הדפדפן לא תומך באיתור מיקום.", true); return; }
  setStatus("מאתר את המיקום שלך…");
  navigator.geolocation.getCurrentPosition((pos) => {
    const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const { loc, dist } = nearest(pt);
    if (dist > 60) { setStatus("המיקום שלך מחוץ לאזור התחזית של השירות המטאורולוגי הישראלי.", true); return; }
    $("q").value = loc.n;
    show(loc, dist > 3 ? { name: "המיקום שלך", dist } : null);
    scrollToReport();
  }, () => setStatus("לא ניתן לאתר מיקום. אשרו גישה למיקום בהגדרות הדפדפן או הקלידו יישוב.", true),
  { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

/* ---------- boot ---------- */
async function boot() {
  const q = $("q");
  q.addEventListener("input", renderSuggest);
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(-1); }
    else if (e.key === "Escape") closeSuggest();
  });
  q.addEventListener("blur", () => setTimeout(closeSuggest, 120));
  $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); search(q.value); });
  $("exportBtn").addEventListener("click", exportExcel);
  $("multiBtn").addEventListener("click", openMulti);
  $("multiForm").addEventListener("submit", (e) => { e.preventDefault(); addMulti($("multiQ").value); });
  $("multiExport").addEventListener("click", exportMulti);
  $("locBtn").addEventListener("click", useMyLocation);

  setStatus("טוען נתונים מהשירות המטאורולוגי…");
  try {
    await loadData();
    setStatus("");
  } catch (e) {
    setStatus("לא ניתן לטעון את נתוני התחזית. בדקו את החיבור לאינטרנט ונסו שוב.", true);
    return;
  }

  const fromHash = decodeURIComponent(location.hash.slice(1));
  let last = null;
  try { last = localStorage.getItem("ronen-last"); } catch (e) {}
  const start = (fromHash && matchLocal(fromHash)[0]) || (last && LOCS.find((l) => l.id === last));
  if (start) { q.value = start.n; show(start); }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
