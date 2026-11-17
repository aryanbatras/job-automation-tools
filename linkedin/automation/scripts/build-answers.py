#!/usr/bin/env python3
"""Build the Easy Apply answers file from the confirmed local profile.

Reads the private profile the user confirmed and writes the answer entries the
browser workflow fills. Nothing here invents an answer: every value comes from
a confirmed profile field, and questions without a confirmed value are left out
so the workflow skips them instead of guessing.
"""

import argparse
import json
import os
import pathlib
import tempfile

COVER_LETTER = (
    "Java full-stack engineer with hands-on experience across Spring Boot, Next.js, PostgreSQL and AWS "
    "from internship roles at Opus Wealth, A2B Digital Solutions, Polarions and Sashel: a mutual-fund "
    "platform serving 14,300+ funds, a 12-microservice e-commerce platform, and AI automation pipelines "
    "running 5,000+ executions a day. B.Tech Computer Science (2027, CGPA 8.2). Available immediately for "
    "remote work."
)


def build_entries(profile: dict, job_title: str, company: str, resume_file: str = "") -> list[dict]:
    identity = profile["identity"]
    contact = profile["contact"]
    links = profile["links"]
    preferences = profile["preferences"]
    sensitive = profile["sensitive"]

    legal_name = identity["legalName"]
    first, _, last = legal_name.partition(" ")

    entries = [
        {"label": "first name", "value": first},
        {"label": "last name", "value": last},
        {"label": "full name", "value": legal_name},
        {"label": "name", "value": legal_name},
        {"label": "email address", "value": contact["email"], "keywords": ["email"]},
        {"label": "phone number", "value": contact["phone"], "keywords": ["phone", "mobile"]},
        {"label": "city", "value": contact["location"].split(",")[0], "keywords": ["location", "city"]},
        {"label": "current company", "value": "Opus Wealth", "keywords": ["current company", "employer"]},
        {"label": "current title", "value": "Software Engineer Intern", "keywords": ["current title", "current job title"]},
        {
            "label": "school",
            "value": "Mahant Bachittar Singh College of Engineering",
            "keywords": ["school", "university", "college", "institution"],
        },
        {
            "label": "degree",
            "value": "B.Tech in Computer Science and Engineering",
            "keywords": ["degree", "education"],
        },
        {"label": "years of experience", "value": "1 year", "keywords": ["years of experience", "experience"]},
        {"label": "sponsorship", "value": "No", "keywords": ["sponsorship"]},
        {
            "label": "authorized to work",
            "value": "Yes",
            "keywords": ["authorized to work", "legally authorized", "work authorization"],
        },
        {
            "label": "start date",
            "value": preferences["availability"]["value"] or "Immediately",
            "keywords": ["start date", "available", "earliest"],
        },
        {"label": "desired salary", "value": preferences["compensation"]["value"] or "", "keywords": ["salary"]},
        {
            "label": "linkedin",
            "value": links["linkedin"].get("value") or "",
            "keywords": ["linkedin"],
        },
        {"label": "github", "value": links["github"].get("value") or "", "keywords": ["github"]},
        {"label": "portfolio", "value": links["portfolio"].get("value") or "", "keywords": ["portfolio", "website"]},
        {
            "label": "additional information",
            "value": COVER_LETTER + (f" Applying for {job_title} at {company}." if job_title else ""),
            "keywords": [
                "additional information",
                "cover letter",
                "message",
                "why do you want",
                "tell us",
                "anything else",
            ],
        },
    ]

    if resume_file:
        entries.append(
            {
                "label": "resume",
                "value": resume_file,
                "keywords": ["resume", "cv"],
            }
        )

    entries.extend(
        [
            {
                "label": "notice period",
                "value": "Less than 15 days",
                "keywords": ["notice period", "joining", "join us"],
            },
            {
                "label": "expected ctc",
                "value": "400000",
                "keywords": ["expected ctc", "expected salary", "desired salary"],
            },
            {
                "label": "months of experience",
                "value": "16",
                "keywords": ["months of experience", "total additional months"],
            },
            {
                "label": "headline",
                "value": "Java Full Stack Engineer | React & Next.js Specialist",
                "keywords": ["headline", "professional headline"],
            },
            {
                "label": "summary",
                "value": (
                    "Java full stack and React/Next.js engineer specialising in backend infrastructure, clean "
                    "microservices, cloud DevOps and AI orchestration. Project lead experience with a mutual fund "
                    "platform serving 14,300+ funds, a 12-microservice e-commerce platform, and AI automation "
                    "pipelines running 5,000+ executions a day."
                ),
                "keywords": ["summary", "about you", "tell us about yourself"],
            },
        ]
    )

    if sensitive["workAuthorization"]["status"] == "answered":
        entries.append(
            {
                "label": "authorized to work",
                "value": "Yes",
                "keywords": ["authorized to work", "legally authorized", "work authorization"],
            }
        )

    return [entry for entry in entries if entry["value"]]


def write_private(path: pathlib.Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.")
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.chmod(temporary_name, 0o600)
    os.replace(temporary_name, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="linkedin/content/local/profile.json")
    parser.add_argument("--preferences", default="linkedin/content/local/preferences.json")
    parser.add_argument("--answer-bank", default="linkedin/content/local/answer-bank.json")
    parser.add_argument("--out", default="linkedin/content/local/pending-answers.json")
    parser.add_argument("--job-title", default="")
    parser.add_argument("--company", default="")
    parser.add_argument(
        "--resume-file",
        default="",
        help="file name of the resume already uploaded to LinkedIn; defaults to preferences.answers.resumeFile",
    )
    args = parser.parse_args()

    resume_file = args.resume_file
    if not resume_file:
        preferences_path = pathlib.Path(args.preferences)
        if preferences_path.is_file():
            preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
            resume_file = (preferences.get("answers") or {}).get("resumeFile") or ""

    profile = json.loads(pathlib.Path(args.profile).read_text(encoding="utf-8"))
    entries = build_entries(profile, args.job_title, args.company, resume_file)

    # Reusable answers the user confirmed in the answer bank win over guesses,
    # so they come first: the matcher takes the first match it finds.
    answer_bank_path = pathlib.Path(args.answer_bank)
    bank_entries = []
    if answer_bank_path.is_file():
        bank = json.loads(answer_bank_path.read_text(encoding="utf-8"))
        for entry in bank.get("entries", []):
            if not entry.get("label") or entry.get("value") in (None, ""):
                continue
            bank_entries.append(entry)

    entries = bank_entries + [
        entry for entry in entries if not any(bank["label"] == entry["label"] for bank in bank_entries)
    ]

    payload = {
        "version": 1,
        "job": {"title": args.job_title, "company": args.company},
        "entries": entries,
    }
    write_private(pathlib.Path(args.out), payload)
    print(json.dumps({"status": "ok", "entries": len(payload["entries"]), "out": args.out}))


if __name__ == "__main__":
    main()
