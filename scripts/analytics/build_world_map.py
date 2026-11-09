#!/usr/bin/env python3
"""Convert reviewed Natural Earth GeoJSON to the dashboard's offline SVG map.

Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
License: https://www.naturalearthdata.com/about/terms-of-use/ (public domain)
The source digest prevents silently replacing reviewed boundaries or labels.
Usage: python3 scripts/analytics/build_world_map.py /path/to/source.geojson
"""
import hashlib
import json
from pathlib import Path
import sys

EXPECTED_SHA256 = "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f"


def main():
    source = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(source).hexdigest() != EXPECTED_SHA256:
        raise SystemExit("Source changed. Review the new dataset before updating the expected digest.")
    rows = []
    for feature in json.loads(source)["features"]:
        p, g = feature["properties"], feature["geometry"]
        polygons = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        paths = []
        for polygon in polygons:
            for ring in polygon:
                points = [(round((lng + 180) * 1000 / 360, 2), round((90 - lat) * 500 / 180, 2)) for lng, lat, *_ in ring]
                paths.append("M" + "L".join(f"{x},{y}" for x, y in points) + "Z")
        iso = p.get("ISO_A2_EH") or p.get("ISO_A2")
        rows.append({"iso": iso if len(iso) == 2 else p["ADM0_A3"], "name": p["NAME_EN"], "path": "".join(paths),
                     "x": round((p["LABEL_X"] + 180) * 1000 / 360, 2), "y": round((90 - p["LABEL_Y"]) * 500 / 180, 2)})
    output = Path(__file__).resolve().parents[2] / "apps/dashboard/public/analytics-world.json"
    output.write_text(json.dumps(rows, separators=(",", ":")) + "\n")
    print(f"Wrote {len(rows)} country outlines to {output}")


if __name__ == "__main__":
    main()
