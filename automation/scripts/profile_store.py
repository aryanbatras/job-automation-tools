#!/usr/bin/env python3
"""Initialize and safely update the local job-application JSON store."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


CONTENT_ROOT = Path(__file__).resolve().parents[1] / "content"
EXAMPLES_ROOT = CONTENT_ROOT / "examples"
LEGACY_PROFILE = Path(__file__).resolve().parents[1] / "profile.local.json"
EXAMPLE_FILES = {
    "profile.example.json": "profile.json",
    "answer-bank.example.json": "answer-bank.json",
    "site-policies.example.json": "site-policies.json",
}
SENSITIVE_PROFILE_FIELDS = (
    "workAuthorization",
    "sponsorship",
    "criminalHistory",
    "disability",
    "veteranStatus",
    "eeoDemographics",
)
EXPLICIT_STATUSES = {"answered", "prefer_not_to_disclose", "not_applicable"}
APPLICATION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
DOMAIN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\Z")
BUILTIN_DOMAINS = ("linkedin.com", "wellfound.com", "ashbyhq.com", "docs.google.com")


def write_private_json(path: Path, payload: dict[str, Any]) -> None:
    """Atomically write JSON with owner-only permissions where supported."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix":
        path.parent.chmod(0o700)

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        if os.name == "posix":
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        if os.name == "posix":
            path.chmod(0o600)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary_path.unlink(missing_ok=True)
        raise


def _read_object(path: Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("expected_object")
    return value


def _legacy_profile(profile: dict[str, Any]) -> dict[str, Any]:
    migrated = _read_object(EXAMPLES_ROOT / "profile.example.json")
    full_name = profile.get("fullName")
    if isinstance(full_name, str) and full_name.strip():
        migrated["identity"]["legalName"] = full_name.strip()

    for key in ("email", "phone", "location"):
        value = profile.get(key)
        if isinstance(value, str):
            migrated["contact"][key] = value.strip()

    for key, legacy_key in (("linkedin", "linkedinUrl"), ("github", "githubUrl"), ("portfolio", "portfolioUrl")):
        value = profile.get(legacy_key)
        if isinstance(value, str) and value.strip():
            migrated["links"][key] = {"status": "answered", "value": value.strip()}

    resume_path = profile.get("resumePath")
    if isinstance(resume_path, str):
        migrated["resume"]["sourcePath"] = resume_path.strip()

    # Imported values remain unconfirmed until the user reviews them.
    migrated["onboarding"]["confirmed"] = False
    migrated["resume"]["confirmed"] = False
    return migrated


def initialize_store(content_root: Path, legacy_profile: Path | None = None) -> None:
    """Copy missing templates without replacing local files or legacy data."""
    content_root = Path(content_root)
    local_root = content_root / "local"
    profile_path = local_root / "profile.json"
    legacy_profile = Path(legacy_profile) if legacy_profile is not None else None
    legacy_exists = legacy_profile is not None and legacy_profile.is_file()

    if profile_path.exists() and legacy_exists:
        raise FileExistsError("profile_conflict")

    migrated_profile = None
    if legacy_exists:
        migrated_profile = _legacy_profile(_read_object(legacy_profile))

    local_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix":
        local_root.chmod(0o700)

    for example_name, local_name in EXAMPLE_FILES.items():
        destination = local_root / local_name
        if destination.exists():
            if os.name == "posix" and destination.is_file():
                destination.chmod(0o600)
            continue
        source = EXAMPLES_ROOT / example_name
        payload = migrated_profile if local_name == "profile.json" and migrated_profile is not None else _read_object(source)
        write_private_json(destination, payload)

    applications = local_root / "applications"
    applications.mkdir(exist_ok=True, mode=0o700)
    if os.name == "posix":
        applications.chmod(0o700)


def _is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_allowed_status(value: Any, allowed: set[str]) -> bool:
    return isinstance(value, str) and value in allowed


def _section_status(section: Any, path: str, allowed: set[str], needs_value: bool = True) -> list[str]:
    if not isinstance(section, dict):
        return [f"{path}.status"]

    status = section.get("status")
    if not _is_allowed_status(status, allowed):
        return [f"{path}.status"]
    if status == "answered" and needs_value and not _is_nonempty_string(section.get("value")):
        return [f"{path}.value"]
    return []


def validate_profile(profile: dict[str, Any]) -> list[str]:
    """Return missing/invalid JSON paths, never the values themselves."""
    if not isinstance(profile, dict):
        return ["$"]
    missing: list[str] = []

    if profile.get("version") != 1:
        missing.append("version")
    if not isinstance(profile.get("onboarding"), dict) or profile["onboarding"].get("confirmed") is not True:
        missing.append("onboarding.confirmed")

    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    for key in ("legalName", "preferredName"):
        if not _is_nonempty_string(identity.get(key)):
            missing.append(f"identity.{key}")

    contact = profile.get("contact") if isinstance(profile.get("contact"), dict) else {}
    for key in ("email", "phone", "location"):
        if not _is_nonempty_string(contact.get(key)):
            missing.append(f"contact.{key}")
    if _is_nonempty_string(contact.get("email")) and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", contact["email"]):
        missing.append("contact.email")

    resume = profile.get("resume") if isinstance(profile.get("resume"), dict) else {}
    if not _is_nonempty_string(resume.get("sourcePath")):
        missing.append("resume.sourcePath")
    if resume.get("confirmed") is not True:
        missing.append("resume.confirmed")

    links = profile.get("links") if isinstance(profile.get("links"), dict) else {}
    for key in ("linkedin", "github", "portfolio"):
        link = links.get(key)
        if not isinstance(link, dict) or not _is_allowed_status(link.get("status"), {"answered", "not_applicable"}):
            missing.append(f"links.{key}.status")
        elif link["status"] == "answered" and not _is_nonempty_string(link.get("value")):
            missing.append(f"links.{key}.value")

    for section_name in ("employment", "education", "skills", "certifications"):
        section = profile.get(section_name)
        if not isinstance(section, dict) or not _is_allowed_status(section.get("status"), {"answered", "not_applicable"}):
            missing.append(f"{section_name}.status")
        elif not isinstance(section.get("items"), list) or (section["status"] == "answered" and not section["items"]):
            missing.append(f"{section_name}.items")

    preferences = profile.get("preferences") if isinstance(profile.get("preferences"), dict) else {}
    for key in ("targetRoles", "locations", "workModes"):
        values = preferences.get(key)
        if not isinstance(values, list) or not values or not all(_is_nonempty_string(value) for value in values):
            missing.append(f"preferences.{key}")
    for key in ("availability", "compensation", "travelRelocation"):
        missing.extend(_section_status(preferences.get(key), f"preferences.{key}", EXPLICIT_STATUSES))

    sensitive = profile.get("sensitive") if isinstance(profile.get("sensitive"), dict) else {}
    for key in SENSITIVE_PROFILE_FIELDS:
        missing.extend(_section_status(sensitive.get(key), f"sensitive.{key}", EXPLICIT_STATUSES))

    return sorted(set(missing))


def validate_site_policy(policy: dict[str, Any]) -> list[str]:
    """Validate fail-closed domain policy without echoing arbitrary values."""
    if not isinstance(policy, dict):
        return ["$"]
    errors: list[str] = []
    default = policy.get("default")
    if not isinstance(default, dict) or default.get("captcha") != "stop":
        errors.append("default.captcha")

    domains = policy.get("domains")
    if not isinstance(domains, dict):
        return sorted(set(errors + ["domains"]))

    for domain, settings in domains.items():
        if not isinstance(domain, str) or not DOMAIN.fullmatch(domain):
            errors.append("domains.<domain>")
            continue
        if not isinstance(settings, dict):
            errors.append(f"domains.{domain}")
            continue
        captcha = settings.get("captcha", "stop")
        if not _is_allowed_status(captcha, {"stop", "human_handoff"}):
            errors.append(f"domains.{domain}.captcha")
        if (domain == "linkedin.com" or domain.endswith(".linkedin.com")) and captcha != "stop":
            errors.append(f"domains.{domain}.captcha")

        is_builtin = any(domain == root or domain.endswith(f".{root}") for root in BUILTIN_DOMAINS)
        if not is_builtin:
            if settings.get("application") != "generic":
                errors.append(f"domains.{domain}.application")
            if settings.get("enabled") is not True:
                errors.append(f"domains.{domain}.enabled")
        elif settings.get("application") == "generic" and settings.get("enabled") is not True:
            errors.append(f"domains.{domain}.enabled")
        elif settings.get("enabled") is True:
            errors.append(f"domains.{domain}.application")

    return sorted(set(errors))


def record_answer(content_root: Path, entry: dict[str, Any]) -> None:
    """Append one explicitly user-confirmed answer to the local answer bank."""
    if not isinstance(entry, dict) or entry.get("userConfirmed") is not True:
        raise ValueError("answer_not_confirmed")
    if not _is_nonempty_string(entry.get("question")):
        raise ValueError("question_required")
    status = entry.get("status")
    if not _is_allowed_status(status, EXPLICIT_STATUSES):
        raise ValueError("answer_status_invalid")
    if status == "answered" and not _is_nonempty_string(entry.get("answer")):
        raise ValueError("answer_required")
    if not _is_nonempty_string(entry.get("source")):
        raise ValueError("answer_source_required")

    answer_path = Path(content_root) / "local" / "answer-bank.json"
    bank = _read_object(answer_path) if answer_path.exists() else {"version": 1, "entries": []}
    entries = bank.get("entries")
    if not isinstance(entries, list):
        raise ValueError("answer_bank_invalid")
    bank["entries"] = [*entries, entry]
    write_private_json(answer_path, bank)


def save_application(content_root: Path, application_id: str, record: dict[str, Any]) -> None:
    """Atomically save one application record under a constrained identifier."""
    if not isinstance(application_id, str) or not APPLICATION_ID.fullmatch(application_id):
        raise ValueError("application_id_invalid")
    if not isinstance(record, dict):
        raise ValueError("application_record_invalid")
    if "id" in record and record["id"] != application_id:
        raise ValueError("application_id_mismatch")

    payload = dict(record)
    payload.setdefault("version", 1)
    payload["id"] = application_id
    write_private_json(Path(content_root) / "local" / "applications" / f"{application_id}.json", payload)


def preflight(content_root: Path) -> dict[str, Any]:
    """Report whether the local store is ready for automation, without echoing values."""
    local_root = Path(content_root) / "local"
    checks: dict[str, str] = {}

    profile_path = local_root / "profile.json"
    if not profile_path.is_file():
        checks["profile"] = "missing"
    else:
        try:
            profile = _read_object(profile_path)
        except (OSError, ValueError, json.JSONDecodeError):
            checks["profile"] = "invalid"
        else:
            checks["profile"] = "ok" if not validate_profile(profile) else "incomplete"

    answer_path = local_root / "answer-bank.json"
    if not answer_path.is_file():
        checks["answerBank"] = "missing"
    else:
        try:
            bank = _read_object(answer_path)
        except (OSError, ValueError, json.JSONDecodeError):
            checks["answerBank"] = "invalid"
        else:
            checks["answerBank"] = "ok" if isinstance(bank.get("entries"), list) else "invalid"

    policy_path = local_root / "site-policies.json"
    if not policy_path.is_file():
        checks["sitePolicies"] = "missing"
    else:
        try:
            policy = _read_object(policy_path)
        except (OSError, ValueError, json.JSONDecodeError):
            checks["sitePolicies"] = "invalid"
        else:
            checks["sitePolicies"] = "ok" if not validate_site_policy(policy) else "invalid"

    ready = all(value == "ok" for value in checks.values())
    return {"status": "ready" if ready else "blocked", "checks": checks}


def _read_private_input(path: Path, local_root: Path) -> dict[str, Any]:
    path = Path(path).resolve()
    local_root = Path(local_root).resolve()
    if not path.is_relative_to(local_root):
        raise ValueError("input_outside_local_store")
    return _read_object(path)


def _json_status(payload: dict[str, Any], stream: Any = None) -> None:
    print(json.dumps(payload, ensure_ascii=False), file=stream or sys.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content-root", type=Path, default=CONTENT_ROOT)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("profile-status")
    commands.add_parser("preflight")
    commands.add_parser("validate-site-policy")
    record = commands.add_parser("record-answer")
    record.add_argument("--input-file", required=True, type=Path)
    application = commands.add_parser("save-application")
    application.add_argument("--id", required=True)
    application.add_argument("--input-file", required=True, type=Path)
    args = parser.parse_args(argv)
    local_root = args.content_root / "local"

    try:
        if args.command == "init":
            legacy = LEGACY_PROFILE if LEGACY_PROFILE.is_file() else None
            initialize_store(args.content_root, legacy_profile=legacy)
            _json_status({"status": "initialized"})
            return 0
        if args.command == "profile-status":
            profile_path = local_root / "profile.json"
            profile = _read_object(profile_path) if profile_path.exists() else {}
            missing = validate_profile(profile)
            _json_status({"status": "complete" if not missing else "incomplete", "missing": missing})
            return 0
        if args.command == "preflight":
            report = preflight(args.content_root)
            _json_status(report)
            return 0 if report["status"] == "ready" else 2
        if args.command == "validate-site-policy":
            policy_path = local_root / "site-policies.json"
            policy = _read_object(policy_path) if policy_path.exists() else {}
            invalid = validate_site_policy(policy)
            _json_status({"status": "valid" if not invalid else "invalid", "invalid": invalid})
            return 0
        if args.command == "record-answer":
            record_answer(args.content_root, _read_private_input(args.input_file, local_root))
            _json_status({"status": "saved"})
            return 0
        if args.command == "save-application":
            save_application(args.content_root, args.id, _read_private_input(args.input_file, local_root))
            _json_status({"status": "saved"})
            return 0
    except FileExistsError:
        _json_status({"status": "error", "reason": "profile_conflict"}, stream=sys.stderr)
    except (OSError, ValueError, json.JSONDecodeError):
        _json_status({"status": "error", "reason": "invalid_local_data"}, stream=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
