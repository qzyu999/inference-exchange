"""Daily reference observations. Keep each raw source/model series separate."""
import time

from .comparison_identity import source_key


def history_response(rows, *, generation, days):
    daily = {}
    for row in rows:
        day = time.strftime("%Y-%m-%d", time.gmtime(row["fetched_at"]))
        key = (row["source"], row["model_id"], day)
        prior = daily.get(key)
        if prior is None or row["fetched_at"] > prior["fetched_at"]:
            daily[key] = row
    series = {}
    legacy = {}
    for (source, model_id, day), row in sorted(daily.items()):
        point = {"at": row["fetched_at"], "input": row["input_per_mtok"],
                 "cache_read": row["cache_per_mtok"], "output": row["output_per_mtok"]}
        item = series.setdefault((source, model_id), {
            "source": source, "model_id": model_id, "display_name": row["display_name"], "points": [],
        })
        item["points"].append(point)
        # Keep compatibility fields without collapsing distinct models per source.
        legacy.setdefault(day, {})[source_key(source, model_id)] = {
            "input": point["input"], "output": point["output"],
        }
    return {"generation": generation, "days": days, "series": list(series.values()),
            "data_points": len(legacy),
            "history": [{"date": date, "prices": prices} for date, prices in sorted(legacy.items())]}
