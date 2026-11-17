#!/usr/bin/env python3
"""Record the engine's run results in the user's local application log.

The engine never writes files itself. This helper turns one engine report into
a user-facing markdown log, a machine-readable JSON log, and a gap list that
shows which fields still need an answer.
"""

import argparse
import datetime
import json
import pathlib
import tempfile
import os


def write_private(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.")
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(text)
    os.chmod(temporary_name, 0o600)
    os.replace(temporary_name, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="engine report JSON")
    parser.add_argument("--markdown", default="linkedin/content/local/applications.md")
    parser.add_argument("--json", dest="json_path", default="linkedin/content/local/applications.json")
    parser.add_argument("--gaps", default="linkedin/content/local/field-gaps.json")
    args = parser.parse_args()

    report = json.loads(pathlib.Path(args.input).read_text(encoding="utf-8"))
    results = report.get("results", report if isinstance(report, list) else [])

    markdown_path = pathlib.Path(args.markdown)
    json_path = pathlib.Path(args.json_path)
    gaps_path = pathlib.Path(args.gaps)

    existing = json.loads(json_path.read_text(encoding="utf-8")) if json_path.exists() else []
    if isinstance(existing, dict):
        existing = existing.get("applications", [])

    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    header = "" if markdown_path.exists() else (
        "# Applications\n\n| When | Job | Company | Location | Result | Detail |\n|---|---|---|---|---|---|\n"
    )

    lines = [header]
    for record in results:
        detail = record.get("reason") or ""
        gaps = record.get("gaps") or []
        if gaps and not detail:
            detail = "; ".join(gaps[:4])
        lines.append(
            "| {when} | {job} | {company} | {location} | {result} | {detail} |\n".format(
                when=stamp,
                job=record.get("job", ""),
                company=record.get("company", ""),
                location=record.get("location", ""),
                result=record.get("result", ""),
                detail=detail.replace("|", "/"),
            )
        )
        existing.append({**record, "when": stamp})

    with markdown_path.open("a", encoding="utf-8") as stream:
        stream.write("".join(lines))

    write_private(json_path, json.dumps(existing, ensure_ascii=False, indent=2) + "\n")

    gaps = []
    if gaps_path.exists():
        try:
            gaps = json.loads(gaps_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            gaps = []
    if isinstance(gaps, dict):
        gaps = gaps.get("gaps", [])
    for record in results:
        for gap in record.get("gaps") or []:
            gaps.append({"job": record.get("job", ""), "company": record.get("company", ""), "gap": gap})
    write_private(gaps_path, json.dumps(gaps, ensure_ascii=False, indent=2) + "\n")

    counts = {}
    for record in results:
        counts[record.get("result", "")] = counts.get(record.get("result", ""), 0) + 1
    print(json.dumps({"status": "ok", "recorded": len(results), "counts": counts}))


if __name__ == "__main__":
    main()
