#!/usr/bin/env python3
"""Extract text from a local resume into the ignored JSON draft store."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if __package__:
    from .profile_store import CONTENT_ROOT, write_private_json
else:
    from profile_store import CONTENT_ROOT, write_private_json


MAX_INPUT_BYTES = 20 * 1024 * 1024
SUPPORTED_FORMATS = {".txt": "txt", ".docx": "docx", ".pdf": "pdf"}


def _docx_text(source_path: Path) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = Document(str(source_path))

    def blocks_text(container: Any) -> list[str]:
        text: list[str] = []
        for block in container.iter_inner_content():
            if isinstance(block, Paragraph):
                if block.text.strip():
                    text.append(block.text.strip())
            elif isinstance(block, Table):
                for row in block.rows:
                    for cell in row.cells:
                        text.extend(blocks_text(cell))
        return text

    return "\n".join(blocks_text(document))


def _pdf_text(source_path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(source_path), strict=True)
    return "\n".join(
        text.strip()
        for page in reader.pages
        if (text := page.extract_text() or "").strip()
    )


def extract_resume(source_path: Path, output_path: Path) -> dict[str, Any]:
    """Extract supported resume text and write it privately; never return text."""
    source_path = Path(source_path)
    suffix = source_path.suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise ValueError("resume_format_unsupported")
    if not source_path.is_file():
        raise ValueError("resume_file_missing")
    if source_path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("resume_too_large")

    file_format = SUPPORTED_FORMATS[suffix]
    try:
        if file_format == "txt":
            text = source_path.read_text(encoding="utf-8-sig")
        elif file_format == "docx":
            text = _docx_text(source_path)
        else:
            text = _pdf_text(source_path)
    except Exception:
        raise ValueError("resume_parse_failed") from None

    text = text.strip()
    status = "ok" if text else "ocr_required" if file_format == "pdf" else "empty"
    draft = {
        "version": 1,
        "sourceName": source_path.name,
        "format": file_format,
        "extractedAt": datetime.now(timezone.utc).isoformat(),
        "text": text,
        "characterCount": len(text),
    }
    write_private_json(Path(output_path), draft)
    return {"status": status, "format": file_format, "characterCount": len(text)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resume_path", type=Path)
    parser.add_argument("--content-root", type=Path, default=CONTENT_ROOT)
    args = parser.parse_args(argv)

    output_path = args.content_root / "local" / "resume-draft.json"
    try:
        result = extract_resume(args.resume_path, output_path)
    except (OSError, ValueError):
        print(json.dumps({"status": "error", "reason": "resume_unreadable"}), file=sys.stderr)
        return 2

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
