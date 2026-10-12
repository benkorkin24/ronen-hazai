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

  // table
  const tb = $("fcBody");
  tb.innerHTML = "";
  for (const [iso, d] of days) {
    const desc = DB.codes[d.c] || "";
    const rc = d.rc == null ? null : Math.round(d.rc);
    const uvCls = d.uv >= 8 ? "uv-xhi" : d.uv >= 6 ? "uv-hi" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="c-day"><div class="day-name">${dayName(iso)}</div><div class="day-date">${shortDate(iso)}</div></td>
      <td class="c-cond"><div class="cond">${icon(d.c)}<span>${desc}</span></div></td>
      <td class="c-temp num"><div class="temps">${fmt(d.mx)}° <span>/ ${fmt(d.mn)}°</span></div></td>
      <td class="c-rain"><div class="rain"><span class="rain-pct">${rc == null ? "—" : rc + "%"}</span><div class="rain-bar" role="img" aria-label="סיכוי לגשם ${rc ?? 0}%"><i style="width:${rc || 0}%"></i></div></div></td>
      <td class="c-mm num">${fmt(d.rm, 1)}</td>
      <td class="c-wind num">${fmt(d.w)} / ${fmt(d.g)}</td>
      <td class="c-uv num ${uvCls}">${fmt(d.uv)}</td>
      <td class="c-hum num">${d.h == null ? "—" : d.h + "%"}</td>
      <td class="c-extra">גשם ${fmt(d.rm, 1)} מ״מ · רוח ${fmt(d.w)} (משבים ${fmt(d.g)}) קמ״ש · UV ${fmt(d.uv)} · לחות ${d.h == null ? "—" : d.h + "%"}</td>`;
    tb.appendChild(tr);
  }

  // national outlook for today
  const firstDay = days[0] && days[0][0];
  const nat = DB.country && DB.country[firstDay];
  $("national").innerHTML = nat ? '<h3>התחזית הארצית</h3><p></p>' : "";
  if (nat) $("national").querySelector("p").textContent = nat;

  const rep = $("report");
  rep.hidden = false;
  rep.classList.remove("enter"); void rep.offsetWidth; rep.classList.add("enter");
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
function exportExcel() {
  if (!current) return;
  if (!window.XLSX) { setStatus("רכיב הייצוא לאקסל עוד לא נטען. נסו שוב בעוד רגע.", true); return; }
  const { loc, days, alerts, notes, via } = current;
  const rows = [
    ["רונן החזאי – תחזית מזג אוויר"],
    ["מקום", via ? `${loc.n} (תחנה קרובה ל${via.name})` : loc.n],
    ["עדכון אחרון", DB.updated],
    ["מקור", DB.source],
    [],
    ["תאריך", "יום", "מצב", "טמפ׳ מקסימלית (°C)", "טמפ׳ מינימלית (°C)", "סיכוי לגשם (%)", "כמות גשם (מ״מ)", "רוח (קמ״ש)", "משבים (קמ״ש)", "UV", "לחות ממוצעת (%)"],
    ...days.map(([iso, d]) => [
      iso.split("-").reverse().join("/"), dayName(iso), DB.codes[d.c] || "",
      d.mx, d.mn, d.rc == null ? null : Math.round(d.rc), d.rm, d.w, d.g, d.uv, d.h,
    ]),
    [],
    ["התרעות רשמיות"],
    ...(alerts.length ? alerts.map((a) => [a.kind, a.text]) : [["", "אין התרעות רשמיות לאזור זה"]]),
  ];
  if (notes.length) {
    rows.push([], ["הערות בטיחות לפי נתוני התחזית"], ...notes.map((n) => [n.day, n.text]));
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 16 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "תחזית");
  const safe = loc.n.replace(/[\\/:*?"<>|,]/g, "").replace(/\s+/g, "_");
  XLSX.writeFile(wb, `רונן_החזאי_${safe}_${days[0][0]}.xlsx`);
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
  const head = ["מקום", "תחנת השירות המטאורולוגי", "מרחק מהתחנה (ק״מ)", "תאריך", "יום", "מצב",
    "טמפ׳ מקסימלית (°C)", "טמפ׳ מינימלית (°C)", "סיכוי לגשם (%)", "כמות גשם (מ״מ)", "רוח (קמ״ש)", "משבים (קמ״ש)", "UV", "לחות ממוצעת (%)", "התרעות רשמיות פעילות"];
  const rows = [
    ["רונן החזאי – קובץ אחוד"],
    ["מקומות", multi.length],
    ["עדכון אחרון", DB.updated],
    ["מקור", DB.source],
    [],
    head,
  ];
  const alertRows = [["מקום", "תחנה", "סוג", "פירוט"]];
  for (const m of multi) {
    const days = Object.entries(m.loc.d).sort(([a], [b]) => a.localeCompare(b)).slice(0, DAYS);
    const alerts = officialAlerts(m.loc);
    const notes = derivedNotes(days);
    for (const [iso, d] of days) {
      rows.push([
        m.label, m.loc.n, m.via ? Math.round(m.via.dist) : 0,
        iso.split("-").reverse().join("/"), dayName(iso), DB.codes[d.c] || "",
        d.mx, d.mn, d.rc == null ? null : Math.round(d.rc), d.rm, d.w, d.g, d.uv, d.h,
        alerts.length ? `${alerts.length} (ראו גיליון התרעות)` : "אין",
      ]);
    }
    if (!alerts.length && !notes.length) alertRows.push([m.label, m.loc.n, "", "אין התרעות רשמיות לאזור זה"]);
    alerts.forEach((a) => alertRows.push([m.label, m.loc.n, `${a.kind} (השירות המטאורולוגי)`, a.text]));
    notes.forEach((n) => alertRows.push([m.label, m.loc.n, "הערת בטיחות לפי התחזית", `${n.day} – ${n.text}`]));
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 20 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 22 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: rows.length - 1, c: head.length - 1 } }) };
  const ws2 = XLSX.utils.aoa_to_sheet(alertRows);
  ws2["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 28 }, { wch: 110 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "תחזית אחודה");
  XLSX.utils.book_append_sheet(wb, ws2, "התרעות ובטיחות");
  const firstDay = Object.keys(multi[0].loc.d).sort()[0];
  XLSX.writeFile(wb, `רונן_החזאי_קובץ_אחוד_${multi.length}_מקומות_${firstDay}.xlsx`);
  multiMsg(`הקובץ האחוד ירד, עם ${multi.length} מקומות.`);
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
