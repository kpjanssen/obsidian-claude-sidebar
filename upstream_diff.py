#!/usr/bin/env python3
"""What has upstream changed, and can this fork take it?

`upstream_check.py` answers *whether* upstream moved. It reads the GitHub API
and prints commit subjects, which is enough to know something happened and not
enough to do anything about it. This answers the next question: for each of
those commits, would it apply to this fork, and if not, where does it collide.

The whole design rests on one fact about this repository: it is a real fork
with upstream's full history and an `upstream` remote, not a snapshot import.
So the question is answerable locally with git rather than by scraping patches
out of an API and guessing at line numbers.

**Nothing here touches the working tree, the index, or any branch.** The only
write is `git fetch`, which moves remote-tracking refs and nothing else, and
`git merge-tree --write-tree`, which writes objects to the object database and
returns a tree oid without checking it out. A conflict is *computed*, never
staged. That matters more than it sounds: the tempting implementation is a
`cherry-pick --no-commit` in a loop, and the day that loop is interrupted the
fork is left mid-merge with no record of what it was doing.

## the two kinds of file, which is the whole of the judgement

The fork relates to upstream's files in two different ways, and collapsing
them is what makes a plain "2 conflicts" report useless.

**Replaced.** `manifest.json` carries the fork's own id, name and author;
`styles.css` is entirely rescoped to the fork's view types. An upstream change
to either *always* conflicts, and that conflict says nothing -- it is the fork
working as designed. These are informational: read what upstream did and
decide whether the fork wants the same idea, expressed in its own file.

**Extended.** `main.js` is upstream's plugin with the fork's run-graph view
added to it. The terminal underneath is shared code that should keep receiving
upstream's fixes. A conflict here is the only one that costs anything, and it
is the number this tool exists to surface.

Usage:
    python upstream_diff.py                 # the report
    python upstream_diff.py --json
    python upstream_diff.py --show <sha>    # the actual upstream diff
    python upstream_diff.py --no-fetch      # trust the refs already here

Exit status: 0 when nothing is pending, 2 when at least one commit wants a
look, 1 when the question could not be answered at all. Deliberately three
values rather than the sibling script's two, because "nothing to do" and
"something to do" are the reason a caller runs this.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
UPSTREAM_REMOTE = "upstream"

#: Files whose content this fork replaces outright. An upstream change to one
#: of these conflicts by construction and is informational rather than
#: adoptable. Named rather than derived: "the fork has touched it" is true of
#: `main.js` too, and `main.js` is the opposite case.
REPLACED = frozenset(
    {
        "manifest.json",  # the fork's own id, name, author -- see UPSTREAM.md
        "styles.css",  # rescoped to the fork's view types in full
        "README.md",
        ".gitignore",
        "install.sh",
    }
)

#: Files the fork extends rather than replaces, where upstream's changes are
#: wanted and a conflict is a real cost.
EXTENDED = frozenset({"main.js"})

VERDICT_ADOPT = "adopt"
VERDICT_PORT = "port"
VERDICT_DECIDE = "decide"

#: What each verdict means, printed with the report rather than left implicit.
VERDICT_MEANING = {
    VERDICT_ADOPT: "applies cleanly",
    VERDICT_PORT: "the code applies; only replaced files collide",
    VERDICT_DECIDE: "collides with code the fork extends",
}


class Unavailable(Exception):
    """The question could not be answered. Never confused with 'nothing new'."""


def git(*args, check=True):
    """Run one git command in this repository and return its stdout."""
    proc = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if check and proc.returncode != 0:
        raise Unavailable(
            "git %s failed: %s" % (" ".join(args), (proc.stderr or "").strip())
        )
    return proc.stdout


def upstream_ref():
    """The upstream default branch, or an explanation of why there is none."""
    remotes = git("remote").split()
    if UPSTREAM_REMOTE not in remotes:
        raise Unavailable(
            "no %r remote. This fork shares upstream's history, so the remote is "
            "how that history is reachable: git remote add %s <upstream url>"
            % (UPSTREAM_REMOTE, UPSTREAM_REMOTE)
        )
    head = git("symbolic-ref", "-q", "--short", "refs/remotes/%s/HEAD" % UPSTREAM_REMOTE, check=False)
    if head.strip():
        return head.strip()
    for candidate in ("%s/main" % UPSTREAM_REMOTE, "%s/master" % UPSTREAM_REMOTE):
        if git("rev-parse", "--verify", "-q", candidate, check=False).strip():
            return candidate
    raise Unavailable("could not find a default branch on %r" % UPSTREAM_REMOTE)


def base_commit(ref):
    """The commit this fork actually diverged at.

    Computed with `git merge-base` rather than read out of `UPSTREAM.md`. The
    recorded value is compared against it and reported when the two disagree,
    because a stale record is exactly the failure a tool like this is for.
    """
    return git("merge-base", "HEAD", ref).strip()


def recorded_base():
    """The commit `UPSTREAM.md` claims, or None when it does not say.

    Delegates to `upstream_check._recorded` rather than carrying a second
    copy of the regex. Two copies would drift silently, and the symptom
    would be this tool reporting a divergence its sibling cannot see --
    which is worse than either tool simply being wrong, because it makes the
    pair untrustworthy without making either one obviously broken.
    """
    try:
        from upstream_check import _recorded
    except ImportError as error:  # pragma: no cover - the file sits beside this one
        raise Unavailable("upstream_check.py is not importable: %s" % error)
    try:
        return _recorded()[1]
    except (SystemExit, OSError):
        # _recorded exits when the record names no commit. That is a missing
        # record, not a broken tool, and the survey still has something to say.
        return None


#: `git cherry-pick -x` writes this into the message of the commit it creates.
CHERRY_PICK_TRAILER = re.compile(r"cherry picked from commit ([0-9a-f]{40})")


def adopted_shas(base):
    """Upstream commits this fork has already taken, read from git's own trailers.

    A cherry-pick does not move the merge-base -- it creates a new commit on
    this side rather than sharing history -- so without this the tool reports
    an adopted commit as pending forever, and the report degrades into
    something you learn to ignore.

    The record is `git cherry-pick -x`'s own "(cherry picked from commit
    <sha>)" line, so it is written by the act of adopting rather than
    remembered afterwards. A hand-kept list in a markdown file would be a
    second place to forget.

    The tempting alternative is `git log --cherry-pick`, which matches by
    patch-id. It does not work here: every adoption resolves conflicts in the
    files this fork replaced, so the patch that landed is not the patch
    upstream wrote and its id differs. It would report every adopted commit as
    still pending, and it would do so silently.
    """
    return set(CHERRY_PICK_TRAILER.findall(git("log", "--format=%B", "%s..HEAD" % base)))


def pending_commits(base, ref):
    """Upstream commits not in this fork, oldest first."""
    out = git("log", "--reverse", "--format=%H%x1f%ad%x1f%s", "--date=short", "%s..%s" % (base, ref))
    commits = []
    for line in out.splitlines():
        if not line.strip():
            continue
        sha, date, subject = line.split("\x1f", 2)
        commits.append({"sha": sha, "short": sha[:7], "date": date, "subject": subject})
    return commits


def parse_merge_tree(stdout):
    """``(tree_oid, [conflicted paths])`` from `merge-tree --write-tree --name-only`.

    The output is three sections separated by a blank line: the tree oid, the
    conflicted paths, then prose -- "Auto-merging main.js", "CONFLICT
    (content): Merge conflict in styles.css". Reading past that blank line
    turns each sentence into a filename, and the result is a report that looks
    entirely plausible rather than an error: every message arrives as a file
    the fork has never touched, and one clean commit is graded as needing a
    decision. This function exists so that failure is a unit test.
    """
    lines = stdout.splitlines()
    if not lines or not lines[0].strip():
        raise ValueError("no tree oid")
    conflicted = []
    for line in lines[1:]:
        if not line.strip():
            break
        conflicted.append(line)
    return lines[0].strip(), conflicted


def merge_probe(sha):
    """``{path: conflicted_hunks}`` for merging one upstream commit into HEAD.

    `--write-tree` computes the merge and hands back a tree; nothing is
    checked out and no ref moves. The hunk count comes from the merged blob
    itself, which turns "conflict" into a size -- the difference between a
    ten-minute port and an afternoon.
    """
    proc = subprocess.run(
        [
            "git", "-C", str(REPO_ROOT), "merge-tree", "--write-tree", "--name-only",
            "--merge-base=%s^" % sha, "HEAD", sha,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        tree, conflicted = parse_merge_tree(proc.stdout)
    except ValueError:
        raise Unavailable("git merge-tree said nothing about %s: %s" % (sha, proc.stderr.strip()))

    counts = {}
    for path in conflicted:
        blob = git("cat-file", "blob", "%s:%s" % (tree, path), check=False)
        counts[path] = sum(1 for line in blob.splitlines() if line.startswith("<<<<<<<"))
    return counts


def touched_files(sha):
    return [p for p in git("diff", "--name-only", "%s^" % sha, sha).splitlines() if p.strip()]


def classify(files, conflicts):
    """The verdict for one commit, and the per-file reasoning behind it.

    Pure: takes the two facts git produced and returns a judgement, so the
    judgement is testable without a repository. That separation is the point
    -- the interesting part of this tool is not running git, it is deciding
    what a conflict in a given file means.
    """
    rows = []
    for path in sorted(set(files) | set(conflicts)):
        hunks = conflicts.get(path, 0)
        conflicted = path in conflicts
        if path in REPLACED:
            relation, note = "replaced", "the fork owns this file outright"
        elif path in EXTENDED:
            relation, note = "extended", "shared code the fork adds to"
        else:
            relation, note = "untouched", "the fork has never changed it"
        rows.append(
            {
                "path": path,
                "relation": relation,
                "note": note,
                "conflicted": conflicted,
                "hunks": hunks,
            }
        )

    blocking = [r for r in rows if r["conflicted"] and r["relation"] != "replaced"]
    if blocking:
        verdict = VERDICT_DECIDE
    elif any(r["conflicted"] for r in rows):
        verdict = VERDICT_PORT
    else:
        verdict = VERDICT_ADOPT
    return verdict, rows


def survey(fetch=True):
    ref = upstream_ref()
    if fetch:
        git("fetch", "--quiet", UPSTREAM_REMOTE)
    base = base_commit(ref)
    recorded = recorded_base()
    result = {
        "ref": ref,
        "base": base,
        "recorded_base": recorded,
        "record_matches": recorded is not None and base.startswith(recorded[:7]),
        "adopted": [],
        "commits": [],
    }
    taken = adopted_shas(base)
    for commit in pending_commits(base, ref):
        if commit["sha"] in taken:
            # Listed rather than dropped. "Already taken" and "never existed"
            # are different facts, and the first one is the answer to "why is
            # upstream still ahead of us".
            result["adopted"].append(commit)
            continue
        conflicts = merge_probe(commit["sha"])
        verdict, rows = classify(touched_files(commit["sha"]), conflicts)
        commit["verdict"] = verdict
        commit["files"] = rows
        result["commits"].append(commit)
    return result


def format_report(result):
    lines = []
    if not result["commits"]:
        lines.append("upstream diff: nothing pending -- %s is at %s" % (result["ref"], result["base"][:7]))
    else:
        lines.append(
            "upstream diff: %d commit(s) on %s since %s"
            % (len(result["commits"]), result["ref"], result["base"][:7])
        )
    for commit in result.get("adopted", []):
        lines.append("  already adopted: %s  %s" % (commit["short"], commit["subject"]))
    if result["recorded_base"] and not result["record_matches"]:
        lines.append(
            "  UPSTREAM.md records %s, but this fork actually diverged at %s. "
            "Update the record before trusting anything below."
            % (result["recorded_base"][:7], result["base"][:7])
        )
    for commit in result["commits"]:
        lines.append("")
        lines.append("%s  %s  %s" % (commit["short"], commit["date"], commit["subject"]))
        lines.append("  %s -- %s" % (commit["verdict"].upper(), VERDICT_MEANING[commit["verdict"]]))
        for row in commit["files"]:
            state = ("conflict x%d" % row["hunks"]) if row["conflicted"] else "merges"
            lines.append("    %-24s %-13s %s (%s)" % (row["path"], state, row["relation"], row["note"]))
    if result["commits"]:
        lines.append("")
        lines.append("Read one with:  python upstream_diff.py --show <sha>")
    return "\n".join(lines)


def show(sha, all_files=False):
    paths = [] if all_files else sorted(EXTENDED)
    args = ["show", "--stat", "--patch", sha]
    if paths:
        args += ["--", *paths]
    return git(*args)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print the raw survey instead of a report")
    parser.add_argument("--no-fetch", action="store_true", help="trust the remote-tracking refs already here")
    parser.add_argument("--show", metavar="SHA", help="print one upstream commit's diff to the extended files")
    parser.add_argument("--all-files", action="store_true", help="with --show, include replaced files too")
    args = parser.parse_args(argv)

    try:
        if args.show:
            sys.stdout.write(show(args.show, args.all_files))
            return 0
        result = survey(fetch=not args.no_fetch)
    except Unavailable as error:
        print("upstream diff: UNAVAILABLE -- %s" % error, file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2) if args.json else format_report(result))
    return 2 if result["commits"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
