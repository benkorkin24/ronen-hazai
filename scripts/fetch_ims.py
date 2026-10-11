"""Fetch forecasts and warnings from the Israel Meteorological Service (ims.gov.il)
and write a compact data/forecast.json for the app."""
import json, time, urllib.request
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


def summarize_day(day):
    d = day.get("daily") or {}
    hours = list((day.get("hourly") or {}).values())

    def col(k):
        return [x for x in (num(h.get(k)) for h in hours) if x is not None]

    rc, rain, wind, gust, hum, hs = (col(k) for k in
        ("rain_chance", "rain", "wind_speed", "gust_speed", "relative_humidity", "heat_stress_level"))
    return {
        "c": d.get("weather_code"),
        "mn": num(d.get("minimum_temperature")),
        "mx": num(d.get("maximum_temperature")),
        "uv": num(d.get("maximum_uvi")),
        "rc": max(rc) if rc else None,
        "rm": round(sum(rain), 1) if rain else None,
        "w": max(wind) if wind else None,
        "g": max(gust) if gust else None,
        "h": round(sum(hum) / len(hum)) if hum else None,
        "hs": max(hs) if hs else None,
    }


def main():
    tz = timezone(timedelta(hours=3))
    today = datetime.now(tz).strftime("%Y-%m-%d")
    locs = get("locations_info")
    codes = {k: v["desc"] for k, v in get("weather_codes").items()}
    out_locs, country = {}, {}
    for lid, loc in locs.items():
        try:
            data = get(f"full_forecast_data/{lid}")
        except Exception as e:
            print("skip", lid, loc["name"], e)
            continue
        days = {}
        for date, day in sorted(data.items()):
            if date < today:
                continue
            days[date] = summarize_day(day)
            desc = (day.get("country") or {}).get("description")
            if desc and date not in country:
                country[date] = desc.strip()
        out_locs[lid] = {"n": loc["name"], "lat": num(loc["lat"]), "lon": num(loc["lon"]),
                         "r": loc.get("rid"), "d": days}
        time.sleep(0.15)

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
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated": now, "source": "השירות המטאורולוגי הישראלי – ims.gov.il",
                               "codes": codes, "country": country, "locations": out_locs,
                               "warnings": warnings}, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(out_locs)} locations, {len(warnings)} warnings")


if __name__ == "__main__":
    main()
