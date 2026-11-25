"use strict";
// Places the user refers to by number. Typing the number finds the place; the app and the
// Excel files then show only the number. Coordinates from OpenStreetMap.
const CODES = {
  200: { name: "טללים", lat: 30.9919, lon: 34.7700 },
  201: { name: "דימונה", lat: 31.0708, lon: 35.0412 },
  202: { name: "הר שגיא (הר חריף)", lat: 30.4958, lon: 34.5590 },
  203: { name: "עתלית", lat: 32.6907, lon: 34.9422 },
  204: { name: "קציעות", lat: 30.8910, lon: 34.4505 },
  205: { name: "חצור", lat: 31.7593, lon: 34.7328 },
  206: { name: "טל שחר", lat: 31.8050, lon: 34.9022 },
  207: { name: "ענתות", lat: 31.8151, lon: 35.2797 },
  208: { name: "מכון דוד", lat: 32.8747, lon: 35.0846 },
  209: { name: "מחנה נתן (ליד באר שבע)", lat: 31.2169, lon: 34.7985 },
  210: { name: "נבטים (ערערה בנגב)", lat: 31.2049, lon: 35.0301 },
  211: { name: "נעורה", lat: 32.6245, lon: 35.3772 },
  212: { name: "חיפה", lat: 32.7940, lon: 34.9896 },
  213: { name: "עובדה", lat: 29.9391, lon: 34.9384 },
  214: { name: "עין שמר", lat: 32.4500, lon: 35.0072 },
  215: { name: "פלמחים", lat: 31.9113, lon: 34.6987 },
  216: { name: "ירושלים", lat: 31.7780, lon: 35.2000 },
  217: { name: "כוכב השחר", lat: 31.9602, lon: 35.3494 },
  218: { name: "זיקים", lat: 31.6050, lon: 34.5064 },
  219: { name: "כרמיאל", lat: 32.9159, lon: 35.2934 },
};
