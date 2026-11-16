import importlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STORE_PATH = ROOT / "automation" / "scripts" / "profile_store.py"


def load_store(test_case):
    if not STORE_PATH.exists():
        test_case.fail("automation/scripts/profile_store.py is missing")
    return importlib.import_module("automation.scripts.profile_store")


def valid_profile():
    return {
        "version": 1,
        "onboarding": {"confirmed": True},
        "identity": {"legalName": "Alex Example", "preferredName": "Alex"},
        "contact": {
            "email": "alex@example.test",
            "phone": "+1 555 0100",
            "location": "Remote",
        },
        "resume": {"sourcePath": "/local/resume.pdf", "confirmed": True},
        "links": {
            "linkedin": {"status": "answered", "value": "https://linkedin.com/in/alex"},
            "github": {"status": "not_applicable", "value": None},
            "portfolio": {"status": "not_applicable", "value": None},
        },
        "employment": {"status": "answered", "items": [{"title": "Engineer"}]},
        "education": {"status": "answered", "items": [{"degree": "BSc"}]},
        "skills": {"status": "answered", "items": ["Python"]},
        "certifications": {"status": "not_applicable", "items": []},
        "preferences": {
            "targetRoles": ["Software Engineer"],
            "locations": ["Remote"],
            "workModes": ["remote"],
            "availability": {"status": "answered", "value": "Two weeks"},
            "compensation": {"status": "prefer_not_to_disclose", "value": None},
            "travelRelocation": {"status": "not_applicable", "value": None},
        },
        "sensitive": {
            "workAuthorization": {"status": "answered", "value": "Authorized"},
            "sponsorship": {"status": "not_applicable", "value": None},
            "criminalHistory": {"status": "prefer_not_to_disclose", "value": None},
            "disability": {"status": "prefer_not_to_disclose", "value": None},
            "veteranStatus": {"status": "not_applicable", "value": None},
            "eeoDemographics": {"status": "prefer_not_to_disclose", "value": None},
        },
    }


class ProfileStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content_root = Path(self.temp.name) / "automation" / "content"

    def tearDown(self):
        self.temp.cleanup()

    def test_initializes_example_files_idempotently_and_privately(self):
        store = load_store(self)
        store.initialize_store(self.content_root)

        local = self.content_root / "local"
        self.assertTrue((local / "profile.json").is_file())
        self.assertTrue((local / "answer-bank.json").is_file())
        self.assertTrue((local / "site-policies.json").is_file())
        self.assertTrue((local / "applications").is_dir())
        original = (local / "profile.json").read_bytes()
        store.initialize_store(self.content_root)
        self.assertEqual((local / "profile.json").read_bytes(), original)

        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(local.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((local / "profile.json").stat().st_mode), 0o600)

    def test_validation_requires_complete_profile_and_explicit_sensitive_statuses(self):
        store = load_store(self)
        profile = valid_profile()
        self.assertEqual(store.validate_profile(profile), [])

        profile["sensitive"]["sponsorship"] = {"status": "unanswered", "value": None}
        missing = store.validate_profile(profile)
        self.assertIn("sensitive.sponsorship.status", missing)

    def test_validation_returns_paths_without_echoing_invalid_values(self):
        store = load_store(self)
        profile = valid_profile()
        profile["contact"]["email"] = "PRIVATE-ANSWER-SENTINEL"
        profile["sensitive"]["disability"] = {"status": "answered", "value": "PRIVATE-ANSWER-SENTINEL"}

        missing = store.validate_profile(profile)
        self.assertIn("contact.email", missing)
        self.assertNotIn("PRIVATE-ANSWER-SENTINEL", json.dumps(missing))

    def test_malformed_status_values_return_validation_errors_instead_of_crashing(self):
        store = load_store(self)
        profile = valid_profile()
        profile["sensitive"]["disability"]["status"] = []
        profile["links"]["linkedin"]["status"] = []
        profile["employment"]["status"] = []
        self.assertIn("sensitive.disability.status", store.validate_profile(profile))

        policy = {
            "default": {"captcha": "stop"},
            "domains": {"example.test": {"application": "generic", "enabled": True, "captcha": []}},
        }
        self.assertIn("domains.example.test.captcha", store.validate_site_policy(policy))

    def test_malformed_answer_status_is_rejected_as_invalid_input(self):
        store = load_store(self)
        store.initialize_store(self.content_root)
        entry = {
            "question": "Question",
            "answer": "Answer",
            "status": [],
            "source": "user",
            "userConfirmed": True,
        }
        with self.assertRaises(ValueError):
            store.record_answer(self.content_root, entry)

    def test_site_policy_is_fail_closed_and_requires_generic_domain_opt_in(self):
        store = load_store(self)
        policy = {
            "default": {"captcha": "stop"},
            "domains": {"linkedin.com": {"captcha": "stop"}},
        }
        self.assertEqual(store.validate_site_policy(policy), [])

        policy["domains"]["example.test"] = {"captcha": "stop"}
        errors = store.validate_site_policy(policy)
        self.assertIn("domains.example.test.application", errors)
        self.assertIn("domains.example.test.enabled", errors)

        policy["domains"]["example.test"] = {
            "application": "generic",
            "enabled": True,
            "captcha": "stop",
        }
        self.assertEqual(store.validate_site_policy(policy), [])

    def test_linkedin_cannot_enable_captcha_handoff(self):
        store = load_store(self)
        policy = {
            "default": {"captcha": "stop"},
            "domains": {"linkedin.com": {"captcha": "human_handoff"}},
        }

        self.assertIn("domains.linkedin.com.captcha", store.validate_site_policy(policy))

    def test_initialization_preserves_existing_local_files(self):
        store = load_store(self)
        local = self.content_root / "local"
        local.mkdir(parents=True)
        profile_path = local / "profile.json"
        profile_path.write_text('{"keep":"LOCAL-PROFILE-SENTINEL"}', encoding="utf-8")

        store.initialize_store(self.content_root)

        self.assertEqual(profile_path.read_text(encoding="utf-8"), '{"keep":"LOCAL-PROFILE-SENTINEL"}')

    def test_migrates_legacy_profile_without_deleting_or_confirming_it(self):
        store = load_store(self)
        legacy = Path(self.temp.name) / "profile.local.json"
        legacy.write_text(json.dumps({
            "fullName": "Alex Example",
            "email": "alex@example.test",
            "phone": "+1 555 0100",
            "location": "Remote",
            "linkedinUrl": "https://linkedin.com/in/alex",
            "githubUrl": "",
            "portfolioUrl": "",
            "resumePath": "/local/resume.pdf",
        }), encoding="utf-8")
        original = legacy.read_bytes()

        store.initialize_store(self.content_root, legacy_profile=legacy)

        migrated = json.loads((self.content_root / "local" / "profile.json").read_text(encoding="utf-8"))
        self.assertEqual(migrated["contact"]["email"], "alex@example.test")
        self.assertFalse(migrated["onboarding"]["confirmed"])
        self.assertEqual(legacy.read_bytes(), original)

    def test_conflicting_legacy_and_new_profiles_fail_without_overwrite(self):
        store = load_store(self)
        legacy = Path(self.temp.name) / "profile.local.json"
        legacy.write_text('{"fullName":"Legacy"}', encoding="utf-8")
        local_profile = self.content_root / "local" / "profile.json"
        local_profile.parent.mkdir(parents=True)
        local_profile.write_text('{"identity":"New"}', encoding="utf-8")
        before = local_profile.read_bytes()

        with self.assertRaises(FileExistsError):
            store.initialize_store(self.content_root, legacy_profile=legacy)

        self.assertEqual(local_profile.read_bytes(), before)
        self.assertEqual(legacy.read_text(encoding="utf-8"), '{"fullName":"Legacy"}')

    def test_only_user_confirmed_answers_are_recorded(self):
        store = load_store(self)
        store.initialize_store(self.content_root)
        entry = {
            "question": "Do you need sponsorship?",
            "answer": "No",
            "status": "answered",
            "source": "user",
            "userConfirmed": True,
            "sensitivity": "sensitive",
            "domain": None,
        }
        store.record_answer(self.content_root, entry)
        answers = json.loads((self.content_root / "local" / "answer-bank.json").read_text(encoding="utf-8"))
        self.assertEqual(answers["entries"], [entry])

        entry["userConfirmed"] = False
        with self.assertRaises(ValueError):
            store.record_answer(self.content_root, entry)

    def test_application_id_cannot_escape_local_applications_directory(self):
        store = load_store(self)
        store.initialize_store(self.content_root)

        with self.assertRaises(ValueError):
            store.save_application(self.content_root, "../outside", {"fields": []})

        store.save_application(self.content_root, "app-123", {"fields": []})
        self.assertTrue((self.content_root / "local" / "applications" / "app-123.json").is_file())
        self.assertFalse((self.content_root / "outside.json").exists())

    def test_preflight_blocks_until_profile_answers_and_policy_are_ready(self):
        store = load_store(self)
        local_root = Path(self.temp.name) / "preflight-content"
        command = [
            sys.executable,
            str(ROOT / "automation" / "scripts" / "profile_store.py"),
            "--content-root",
            str(local_root),
        ]

        blocked = subprocess.run([*command, "preflight"], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(blocked.returncode, 2)
        report = json.loads(blocked.stdout)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["checks"]["profile"], "missing")

        store.initialize_store(local_root)
        blocked = subprocess.run([*command, "preflight"], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(blocked.returncode, 2)
        report = json.loads(blocked.stdout)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["checks"]["profile"], "incomplete")
        self.assertEqual(report["checks"]["answerBank"], "ok")
        self.assertEqual(report["checks"]["sitePolicies"], "ok")

        profile_path = local_root / "local" / "profile.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        profile.update(valid_profile())
        profile_path.write_text(json.dumps(profile), encoding="utf-8")

        ready = subprocess.run([*command, "preflight"], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(ready.returncode, 0)
        report = json.loads(ready.stdout)
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["checks"], {"profile": "ok", "answerBank": "ok", "sitePolicies": "ok"})

    def test_preflight_never_prints_profile_values(self):
        local_root = Path(self.temp.name) / "preflight-redaction"
        command = [
            sys.executable,
            str(ROOT / "automation" / "scripts" / "profile_store.py"),
            "--content-root",
            str(local_root),
            "preflight",
        ]
        store = load_store(self)
        store.initialize_store(local_root)
        profile_path = local_root / "local" / "profile.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        profile["contact"]["email"] = "PRIVATE-ANSWER-SENTINEL"
        profile_path.write_text(json.dumps(profile), encoding="utf-8")

        result = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)

        self.assertNotIn("PRIVATE-ANSWER-SENTINEL", result.stdout + result.stderr)

    def test_cli_status_never_prints_profile_values(self):
        local_root = Path(self.temp.name) / "cli-content"
        command = [
            sys.executable,
            str(ROOT / "automation" / "scripts" / "profile_store.py"),
            "--content-root",
            str(local_root),
            "init",
        ]
        if not STORE_PATH.exists():
            self.fail("automation/scripts/profile_store.py is missing")
        subprocess.run(command, check=True, capture_output=True, text=True, cwd=ROOT)

        profile_path = local_root / "local" / "profile.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        profile["contact"]["email"] = "PRIVATE-ANSWER-SENTINEL"
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        status_command = [*command[:-1], "profile-status"]
        result = subprocess.run(status_command, check=True, capture_output=True, text=True, cwd=ROOT)
        self.assertNotIn("PRIVATE-ANSWER-SENTINEL", result.stdout)
        self.assertNotIn("PRIVATE-ANSWER-SENTINEL", result.stderr)


if __name__ == "__main__":
    unittest.main()
