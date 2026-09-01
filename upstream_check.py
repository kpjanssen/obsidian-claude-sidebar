#!/usr/bin/env python3
"""Read-only check of whether upstream has moved since the recorded commit.

Task 7.5/7.8 of proj-flow's `obsidian-flow-plugin` change. Two rules:

  * This script writes no file, anywhere, under any outcome. It only issues
    HTTP GET requests to the GitHub API and prints a report.
  * "Upstream is unreachable" and "upstream is unchanged" are different
    facts and are never collapsed into one another. A network failure, a
    timeout, or a non-2xx response is reported as UNAVAILABLE; only an
    actual, successful comparison is reported as up to date or ahead. The
    `reachable` field defaults to False and is set True in exactly one place
    -- after a successful comparison call -- so an exception anywhere before
    that point cannot leave the result looking like a clean "identical".

Usage:
    python upstream_check.py [--json]

Exit status is 0 when the check ran (whatever it found) and 1 when upstream
could not be reached, so a caller can tell "ran and found nothing new" apart
from "did not get an answer" without parsing the text.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
UPSTREAM_MD = REPO_ROOT / "UPSTREAM.md"
GITHUB_API = "https://api.github.com"
USER_AGENT = "obsidian-claude-sidebar-fork-upstream-check"
REQUEST_TIMEOUT_S = 15


def _recorded():
    """Read the repo/commit/fork-date this fork is pinned to, from the one
    place that ships with the plugin (UPSTREAM.md) rather than a value
    passed in by a caller -- the check is always against what this fork
    actually records, not what someone claims it records."""
    text = UPSTREAM_MD.read_text(encoding="utf-8")
    repo_m = re.search(r"Upstream Repository:\*\*\s*https://github\.com/([^/\s]+/[^/\s)]+)", text)
    commit_m = re.search(r"Upstream Commit:\*\*\s*`([0-9a-f]{7,40})`", text)
    date_m = re.search(r"Fork Date:\*\*\s*(\d{4}-\d{2}-\d{2})", text)
    if not repo_m or not commit_m:
        raise SystemExit(f"could not find upstream repo/commit in {UPSTREAM_MD}")
    return repo_m.group(1), commit_m.group(1), (date_m.group(1) if date_m else None)


def _get_json(url: str):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:  # GET only; nothing here writes
        return json.loads(resp.read().decode("utf-8"))


def check(repo: str | None = None, commit: str | None = None, fork_date: str | None = None) -> dict:
    """Never raises for a reachability problem -- that is reported in the
    result instead, so a caller cannot mistake an unhandled exception for
    "everything is fine"."""
    if repo is None or commit is None:
        repo, commit, fork_date = _recorded()
    result = {"repo": repo, "recorded_commit": commit, "reachable": False}
    try:
        repo_data = _get_json(f"{GITHUB_API}/repos/{repo}")
        default_branch = repo_data.get("default_branch", "main")
        compare = _get_json(f"{GITHUB_API}/repos/{repo}/compare/{commit}...{default_branch}")
        releases = _get_json(f"{GITHUB_API}/repos/{repo}/releases")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as err:
        result["error"] = str(err)
        return result  # reachable stays False -- see the module docstring

    # Only set once a full, successful round trip has happened.
    result["reachable"] = True
    result["default_branch"] = default_branch
    result["status"] = compare.get("status")
    result["commits_ahead"] = compare.get("ahead_by", 0)
    result["commits"] = [
        {"sha": c["sha"][:12], "message": c["commit"]["message"].splitlines()[0]}
        for c in compare.get("commits", []) or []
    ]
    cutoff = (fork_date + "T00:00:00Z") if fork_date else None
    result["releases_since"] = [
        {"tag": r.get("tag_name"), "published_at": r.get("published_at")}
        for r in (releases if isinstance(releases, list) else [])
        if not cutoff or (r.get("published_at") or "") > cutoff
    ]
    return result


def format_report(result: dict) -> str:
    if not result["reachable"]:
        return (
            f"upstream check: UNAVAILABLE ({result['repo']}, recorded {result['recorded_commit'][:12]}) "
            f"-- {result.get('error', 'no response')}"
        )
    lines = []
    if result["status"] == "identical":
        lines.append(f"upstream check: up to date with {result['repo']}@{result['default_branch']}")
    else:
        lines.append(
            f"upstream check: {result['commits_ahead']} commit(s) ahead on "
            f"{result['repo']}@{result['default_branch']} since {result['recorded_commit'][:12]}"
        )
        for c in result["commits"][:15]:
            lines.append(f"  {c['sha']}  {c['message']}")
    if result["releases_since"]:
        lines.append("releases published since the fork date:")
        for r in result["releases_since"]:
            lines.append(f"  {r['tag']}  {r['published_at']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print the raw result as JSON instead of a report")
    args = parser.parse_args(argv)

    result = check()
    print(json.dumps(result, indent=2) if args.json else format_report(result))
    return 0 if result["reachable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
