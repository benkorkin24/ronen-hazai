"use strict";
// Places the user refers to by number. Typing the number finds the place; the app and the
// Excel files then show only the number. Coordinates from OpenStreetMap.
const CODES = {
  200: { name: "ביסל״א", lat: 30.9861, lon: 34.7663 },
  201: { name: "קמ״ג", lat: 31.0009, lon: 35.1459 },
  202: { name: "הר שגיא", lat: 30.3613, lon: 34.6391 },
  203: { name: "עתלית", lat: 32.6907, lon: 34.9422 },
  204: { name: "קציעות", lat: 30.8910, lon: 34.4505 },
  205: { name: "חצור", lat: 31.7593, lon: 34.7328 },
  206: { name: "טל שחר", lat: 31.8050, lon: 34.9022 },
  207: { name: "ענתות", lat: 31.8151, lon: 35.2797 },
  209: { name: "מחנה נתן", lat: 31.2169, lon: 34.7985 },
  210: { name: "נבטים", lat: 31.2049, lon: 35.0301 },
  211: { name: "נעורה", lat: 32.6245, lon: 35.3772 },
  213: { name: "עובדה", lat: 29.9391, lon: 34.9384 },
  214: { name: "עין שמר", lat: 32.4500, lon: 35.0072 },
  215: { name: "פלמחים", lat: 31.9113, lon: 34.6987 },
  217: { name: "כוכב השחר", lat: 31.9602, lon: 35.3494 },
  218: { name: "זיקים", lat: 31.6050, lon: 34.5064 },
};
