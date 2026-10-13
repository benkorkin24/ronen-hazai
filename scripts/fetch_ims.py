"""Fetch forecasts and warnings from the Israel Meteorological Service (ims.gov.il)
and write a compact data/forecast.json for the app."""
import json, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "https://ims.gov.il/he/"
OUT = Path(__file__).resolve().parent.parent / "data" / "forecast.json"
UA = {"User-Agent": "Mozilla/5.0 (RonenHazai forecast app)", "Accept": "application/json"}


def get(path, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(BASE + path, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["data"]
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def summarize_day(day, wind_deg):
    d = day.get("daily") or {}
    hours = sorted((day.get("hourly") or {}).values(), key=lambda h: h.get("hour") or "")

    def col(k):
        return [x for x in (num(h.get(k)) for h in hours) if x is not None]

    rc, rain, wind, gust, hum, hs, feel, chill, pm, wave = (col(k) for k in (
        "rain_chance", "rain", "wind_speed", "gust_speed", "relative_humidity",
        "heat_stress_level", "heat_stress", "wind_chill", "pm10", "wave_height"))

    # wind direction at the windiest hour, in degrees
    wd = None
    if hours:
        top = max(hours, key=lambda h: num(h.get("wind_speed")) or -1)
        wd = wind_deg.get(str(top.get("wind_direction_id")))

    # hours with a meaningful chance of rain (>= 30%)
    wet = [int(h["hour"]) for h in hours if (num(h.get("rain_chance")) or 0) >= 30 and h.get("hour")]

    # 3-hourly series for the chart: [hour, temp, rain chance, wind]
    series = [[int(h["hour"]), num(h.get("precise_temperature") or h.get("temperature")),
               num(h.get("rain_chance")), num(h.get("wind_speed"))]
              for h in hours if h.get("hour") and int(h["hour"]) % 3 == 0]

    return {
        "c": d.get("weather_code"),
        "mn": num(d.get("minimum_temperature")),
        "mx": num(d.get("maximum_temperature")),
        "uv": num(d.get("maximum_uvi")),
        "rc": max(rc) if rc else None,
        "rm": round(sum(rain), 1) if rain else None,
        "w": max(wind) if wind else None,
        "g": max(gust) if gust else None,
        "wd": wd,
        "h": round(sum(hum) / len(hum)) if hum else None,
        "hs": max(hs) if hs else None,
        "fx": round(max(feel)) if feel else None,
        "fn": round(min(chill)) if chill else None,
        "pm": round(max(pm)) if pm else None,
        "wv": max(wave) if wave else None,
        "wet": [min(wet), max(wet)] if wet else None,
        "s": series,
    }


def main():
    tz = timezone(timedelta(hours=3))
    today = datetime.now(tz).strftime("%Y-%m-%d")
    locs = get("locations_info")
    codes = {k: v["desc"] for k, v in get("weather_codes").items()}
    wind_deg = {k: int(v["direction"]) % 360 for k, v in get("wind_directions").items()}
    heat_levels = get("heat_stress_levels")
    out_locs, country = {}, {}
    def fetch(lid):
        try:
            return lid, get(f"full_forecast_data/{lid}")
        except Exception as e:
            print("skip", lid, locs[lid]["name"], e)
            return lid, None

    # a few requests in parallel: a full refresh takes about a minute instead of six
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = dict(pool.map(fetch, locs))

    for lid, loc in locs.items():
        data = results.get(lid)
        if data is None:
            continue
        days = {}
        for date, day in sorted(data.items()):
            if date < today:
                continue
            days[date] = summarize_day(day, wind_deg)
            desc = (day.get("country") or {}).get("description")
            if desc and date not in country:
                country[date] = desc.strip()
        out_locs[lid] = {"n": loc["name"], "lat": num(loc["lat"]), "lon": num(loc["lon"]),
                         "r": loc.get("rid"), "alt": num(loc.get("height")),
                         "coast": loc.get("near_coast") == "1", "d": days}

    warnings = {}
    try:
        wdata = get("warnings").get("full_warnings_data") or {}
        for date, regions in wdata.items():
            for _, items in regions.items():
                for w in items.values():
                    key = w["alert_id"]
                    if key in warnings:
                        continue
                    warnings[key] = {
                        "sev": w.get("severity_id"), "type": w.get("warning_type_id"),
                        "from": w.get("valid_from"), "to": w.get("valid_to"), "sent": w.get("sent"),
                        "he": " ".join((w.get("full_he") or "").split()),
                        "txt": " ".join((w.get("text_full") or w.get("text") or "").split()),
                        "regions": w.get("regions") or [],
                    }
    except Exception as e:
        print("warnings failed", e)

    now = datetime.now(tz).strftime("%Y-%m-%d %H:%M")
    warnings = [w for w in warnings.values() if (w["to"] or "9999") >= now]
    if len(out_locs) < len(locs) * 0.8:
        raise SystemExit(f"only {len(out_locs)}/{len(locs)} locations fetched; keeping the previous file")
    body = {"source": "השירות המטאורולוגי הישראלי – ims.gov.il", "codes": codes, "heat": heat_levels,
            "country": country, "locations": out_locs, "warnings": warnings}
    # rewrite (and so commit) only when IMS data actually changed, not just the clock
    try:
        prev = json.loads(OUT.read_text())
        prev.pop("updated", None)
        if prev == json.loads(json.dumps(body)):
            print("no change in IMS data")
            return
    except (FileNotFoundError, ValueError):
        pass
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated": now, **body}, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(out_locs)} locations, {len(warnings)} warnings")


if __name__ == "__main__":
    main()
