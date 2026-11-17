import importlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
INGEST_PATH = ROOT / "linkedin" / "automation" / "scripts" / "ingest_resume.py"


def load_ingester(test_case):
    if not INGEST_PATH.exists():
        test_case.fail("linkedin/automation/scripts/ingest_resume.py is missing")
    return importlib.import_module("linkedin.automation.scripts.ingest_resume")


class FakePdfPage:
    def __init__(self, text):
        self.text = text

    def extract_text(self):
        return self.text


class ResumeIngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_extracts_text_file_and_stores_text_only_in_local_draft(self):
        ingest = load_ingester(self)
        source = self.root / "resume.txt"
        output = self.root / "content" / "local" / "resume-draft.json"
        text = "TXT-RESUME-SENTINEL\nSenior developer"
        source.write_text(text, encoding="utf-8")

        result = ingest.extract_resume(source, output)

        self.assertEqual(result, {"status": "ok", "format": "txt", "characterCount": len(text)})
        draft = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(draft["text"], text)
        self.assertEqual(draft["sourceName"], "resume.txt")
        self.assertNotIn(str(source), json.dumps(draft))

    def test_extracts_docx_paragraphs_and_table_cells(self):
        ingest = load_ingester(self)
        from docx import Document

        source = self.root / "resume.docx"
        document = Document()
        document.add_paragraph("DOCX-RESUME-SENTINEL")
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "Engineer"
        table.cell(0, 1).text = "Example Company"
        document.save(source)

        result = ingest.extract_resume(source, self.root / "draft.json")
        draft = json.loads((self.root / "draft.json").read_text(encoding="utf-8"))

        self.assertEqual(result["status"], "ok")
        self.assertIn("DOCX-RESUME-SENTINEL", draft["text"])
        self.assertIn("Engineer", draft["text"])
        self.assertIn("Example Company", draft["text"])

    def test_extracts_text_from_pdf_pages(self):
        ingest = load_ingester(self)
        source = self.root / "resume.pdf"
        source.write_bytes(b"synthetic-pdf-input")
        output = self.root / "draft.json"
        with patch("pypdf.PdfReader") as reader:
            reader.return_value.pages = [FakePdfPage("PDF-RESUME-SENTINEL"), FakePdfPage("Second page")]
            result = ingest.extract_resume(source, output)

        draft = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(result, {"status": "ok", "format": "pdf", "characterCount": len("PDF-RESUME-SENTINEL\nSecond page")})
        self.assertEqual(draft["text"], "PDF-RESUME-SENTINEL\nSecond page")

    def test_blank_scanned_pdf_returns_ocr_required_without_remote_ocr(self):
        ingest = load_ingester(self)
        from pypdf import PdfWriter

        source = self.root / "scan.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        with source.open("wb") as stream:
            writer.write(stream)

        result = ingest.extract_resume(source, self.root / "draft.json")
        draft = json.loads((self.root / "draft.json").read_text(encoding="utf-8"))

        self.assertEqual(result["status"], "ocr_required")
        self.assertEqual(draft["text"], "")

    def test_rejects_malformed_pdf_and_unsupported_format(self):
        ingest = load_ingester(self)
        malformed = self.root / "bad.pdf"
        sentinel = b"PRIVATE-PDF-LEAK-SENTINEL"
        malformed.write_bytes(sentinel)
        unsupported = self.root / "resume.png"
        unsupported.write_bytes(b"image")

        with self.assertRaises(ValueError):
            ingest.extract_resume(malformed, self.root / "bad-draft.json")
        with self.assertRaises(ValueError):
            ingest.extract_resume(unsupported, self.root / "unsupported-draft.json")

        result = subprocess.run(
            [sys.executable, str(INGEST_PATH), str(malformed), "--content-root", str(self.root / "content")],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, '{"status": "error", "reason": "resume_unreadable"}\n')

    def test_rejects_files_over_twenty_mib_before_reading(self):
        ingest = load_ingester(self)
        source = self.root / "large.txt"
        with source.open("wb") as stream:
            stream.truncate(20 * 1024 * 1024 + 1)

        with self.assertRaises(ValueError):
            ingest.extract_resume(source, self.root / "draft.json")

    def test_draft_is_owner_only_and_stdout_never_contains_resume_text(self):
        if not INGEST_PATH.exists():
            self.fail("linkedin/automation/scripts/ingest_resume.py is missing")
        content_root = self.root / "content"
        source = self.root / "resume.txt"
        sentinel = "CLI-RESUME-PRIVATE-SENTINEL"
        source.write_text(sentinel, encoding="utf-8")
        command = [
            sys.executable,
            str(INGEST_PATH),
            str(source),
            "--content-root",
            str(content_root),
        ]

        result = subprocess.run(command, check=True, capture_output=True, text=True, cwd=ROOT)

        self.assertNotIn(sentinel, result.stdout)
        self.assertNotIn(sentinel, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "ok")
        draft = content_root / "local" / "resume-draft.json"
        self.assertEqual(json.loads(draft.read_text(encoding="utf-8"))["text"], sentinel)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(draft.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
