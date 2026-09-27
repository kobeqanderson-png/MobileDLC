"""Convert a hosted JSON snapshot to DLC H5 and CSV without editing the local project."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "mobile_dlc_labeler"))
from app import Project  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("project", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.snapshot.read_text(encoding="utf-8"))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    output = args.output or ROOT / "imports" / timestamp
    if output.exists():
        raise SystemExit(f"Output folder already exists: {output}")
    project = Project(args.project, "focus7", output)
    if data.get("schema") != project.schema or data.get("scorer") != project.scorer:
        raise SystemExit("Snapshot schema or scorer does not match the DLC project")
    frames = data.get("frames")
    if not isinstance(frames, list):
        raise SystemExit("Snapshot frames are invalid")
    site = json.loads((ROOT / "project-data.json").read_text(encoding="utf-8"))
    site_frames = {frame["key"]: frame for frame in site["project"]["frames"]}
    keys = [entry.get("key") for entry in frames if isinstance(entry, dict)]
    if len(keys) != len(frames) or len(set(keys)) != len(keys) or not set(project.by_key).issubset(keys) or not set(keys).issubset(site_frames):
        raise SystemExit("Snapshot frame keys do not match the hosted or DLC project")
    for entry in frames:
        points = entry.get("points")
        if not isinstance(points, dict) or set(points) != set(project.parts):
            raise SystemExit(f"Invalid body points for {entry.get('key')}")
        dimensions = site_frames[entry["key"]]
        if any(value is not None and (not isinstance(value, list) or len(value) != 2 or
                any(not isinstance(coord, (int, float)) or isinstance(coord, bool) for coord in value) or
                not 0 <= value[0] < dimensions["width"] or not 0 <= value[1] < dimensions["height"])
                for value in points.values()):
            raise SystemExit(f"Invalid coordinates for {entry['key']}")
        if entry["key"] not in project.by_key:
            continue
        current = project.points(entry["key"])
        changes = {part: value for part, value in points.items() if value != current[part]}
        if changes:
            project.change(entry["key"], changes)
    written = project.export()
    print(f"Exported {len(written)} DLC folders under {output / 'export' / 'labeled-data'}")
    print("The original project and local labeler edits were not changed.")


if __name__ == "__main__":
    main()
