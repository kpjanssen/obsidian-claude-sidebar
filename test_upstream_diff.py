"""Tests for upstream_diff.py.

Run with: python -m unittest test_upstream_diff -v

The two things worth testing here are pure by design, and that is not an
accident of style -- it is the reason the tool is arranged the way it is.
Running git is uninteresting and hard to fixture; deciding what a conflict in
a given file *means*, and reading git's output without mistaking prose for
filenames, are the parts that can be wrong in a way nobody notices.
"""
from __future__ import annotations

import unittest

import upstream_diff as ud


class ParsingMergeTreeOutput(unittest.TestCase):
    """The defect this parser was written to make impossible."""

    # Verbatim from `git merge-tree --write-tree --name-only --merge-base=2f23380^
    # HEAD 2f23380` in this repository on 2026-09-08. Kept as a real capture
    # rather than a hand-typed approximation, because the whole failure mode is
    # a mistake about what git actually prints.
    REAL_OUTPUT = (
        "9e31cdf5d4231144173b3c9212a316533959fbf7\n"
        "manifest.json\n"
        "styles.css\n"
        "\n"
        "Auto-merging main.js\n"
        "Auto-merging manifest.json\n"
        "CONFLICT (content): Merge conflict in manifest.json\n"
        "Auto-merging styles.css\n"
        "CONFLICT (content): Merge conflict in styles.css\n"
    )

    def test_reads_the_tree_oid(self):
        tree, _ = ud.parse_merge_tree(self.REAL_OUTPUT)
        self.assertEqual(tree, "9e31cdf5d4231144173b3c9212a316533959fbf7")

    def test_stops_at_the_section_break(self):
        _, conflicted = ud.parse_merge_tree(self.REAL_OUTPUT)
        self.assertEqual(conflicted, ["manifest.json", "styles.css"])

    def test_does_not_take_a_message_for_a_filename(self):
        """The original bug, stated as the thing it produced.

        Reading past the blank line does not raise. It yields
        "Auto-merging main.js" as a path, which classifies as a file the fork
        has never touched, which turns a clean commit into one needing a
        decision. A plausible wrong answer, which is why it needs a test.
        """
        _, conflicted = ud.parse_merge_tree(self.REAL_OUTPUT)
        for path in conflicted:
            self.assertNotIn(" ", path, "a message leaked into the path list: %r" % path)

    def test_a_clean_merge_lists_nothing(self):
        tree, conflicted = ud.parse_merge_tree("abc123\n")
        self.assertEqual((tree, conflicted), ("abc123", []))

    def test_empty_output_is_refused_rather_than_guessed_at(self):
        with self.assertRaises(ValueError):
            ud.parse_merge_tree("")


class ClassifyingACommit(unittest.TestCase):
    """The judgement: what does a conflict in *this* file mean."""

    def test_no_conflicts_is_adopt(self):
        verdict, _ = ud.classify(["main.js", "README.md"], {})
        self.assertEqual(verdict, ud.VERDICT_ADOPT)

    def test_conflicts_only_in_replaced_files_is_port(self):
        """The 1.10.1 shape: the code applies, the fork's identity files do not.

        manifest.json and styles.css conflict on every upstream release,
        because the fork rewrote both outright. Grading that as blocking would
        make the tool cry wolf on literally every commit.
        """
        verdict, _ = ud.classify(
            ["main.js", "manifest.json", "styles.css"],
            {"manifest.json": 1, "styles.css": 1},
        )
        self.assertEqual(verdict, ud.VERDICT_PORT)

    def test_a_conflict_in_extended_code_is_decide(self):
        """The 1.10.0 shape: main.js collides, and only a person can settle it."""
        verdict, _ = ud.classify(
            ["main.js", "manifest.json"],
            {"main.js": 2, "manifest.json": 1},
        )
        self.assertEqual(verdict, ud.VERDICT_DECIDE)

    def test_a_conflict_in_an_unclassified_file_is_decide(self):
        """An unknown file conflicting is a decision, not a shrug.

        REPLACED is a named set. A file that is in neither set has never been
        thought about, and the safe reading of "I have no rule for this" is
        that somebody should look -- not that it is fine.
        """
        verdict, rows = ud.classify(["src/new-thing.ts"], {"src/new-thing.ts": 3})
        self.assertEqual(verdict, ud.VERDICT_DECIDE)
        self.assertEqual(rows[0]["relation"], "untouched")

    def test_hunk_counts_are_carried_through(self):
        _, rows = ud.classify(["main.js"], {"main.js": 2})
        row = rows[0]
        self.assertTrue(row["conflicted"])
        self.assertEqual(row["hunks"], 2)

    def test_a_clean_file_reports_zero_rather_than_nothing(self):
        _, rows = ud.classify(["main.js"], {})
        self.assertEqual(rows[0]["hunks"], 0)
        self.assertFalse(rows[0]["conflicted"])

    def test_every_row_carries_a_relation_and_a_reason(self):
        """A verdict with no stated reason is the failure mode of this tool.

        The report exists so a person can disagree with it. Each row therefore
        says which of the two relations the file has and why, in words.
        """
        _, rows = ud.classify(["main.js", "manifest.json", "docs/x.md"], {})
        for row in rows:
            self.assertIn(row["relation"], ("replaced", "extended", "untouched"))
            self.assertTrue(row["note"].strip(), "row %r has no reason" % row["path"])

    def test_a_conflicted_file_missing_from_the_diff_still_appears(self):
        """merge-tree can name a file the commit's own diff does not.

        A rename or a delete on either side lands in the conflict list without
        showing up in `git diff <sha>^ <sha>`. Dropping it would hide the one
        file that actually needs attention.
        """
        _, rows = ud.classify([], {"main.js": 1})
        self.assertEqual([r["path"] for r in rows], ["main.js"])


class TheTwoFileSetsAreDisjoint(unittest.TestCase):
    def test_no_file_is_both_replaced_and_extended(self):
        """They mean opposite things, so an overlap would be a silent bug.

        REPLACED short-circuits first in classify, so a file in both sets
        would be graded informational forever -- exactly the wrong way round
        for anything the fork extends.
        """
        self.assertEqual(ud.REPLACED & ud.EXTENDED, frozenset())

    def test_main_js_is_extended(self):
        """Named explicitly, because getting this one backwards is the whole risk."""
        self.assertIn("main.js", ud.EXTENDED)

    def test_every_verdict_has_a_printed_meaning(self):
        for verdict in (ud.VERDICT_ADOPT, ud.VERDICT_PORT, ud.VERDICT_DECIDE):
            self.assertIn(verdict, ud.VERDICT_MEANING)


class ReadingCherryPickProvenance(unittest.TestCase):
    """A cherry-pick does not move the merge-base, so adoption needs a record."""

    # The message git actually wrote when 1.10.1 was adopted on 2026-09-08.
    REAL_MESSAGE = (
        "1.10.1: light mode contrast and terminal scrollbar\n"
        "\n"
        "Light mode uses a light ANSI palette so option prompts are readable (#105).\n"
        "\n"
        "(cherry picked from commit 2f23380e346b9b5a8abfccf14217b7e88ba1ab5d)\n"
    )

    def test_finds_the_adopted_sha(self):
        self.assertEqual(
            ud.CHERRY_PICK_TRAILER.findall(self.REAL_MESSAGE),
            ["2f23380e346b9b5a8abfccf14217b7e88ba1ab5d"],
        )

    def test_finds_several_across_concatenated_messages(self):
        """`git log --format=%B` runs messages together; each trailer still counts."""
        second = "\nsomething else\n\n(cherry picked from commit %s)\n" % ("a" * 40)
        self.assertEqual(len(ud.CHERRY_PICK_TRAILER.findall(self.REAL_MESSAGE + second)), 2)

    def test_a_message_merely_mentioning_a_sha_is_not_a_trailer(self):
        """Prose about a commit is not a claim to have taken it."""
        prose = "Looked at 2f23380e346b9b5a8abfccf14217b7e88ba1ab5d and decided against it."
        self.assertEqual(ud.CHERRY_PICK_TRAILER.findall(prose), [])

    def test_an_abbreviated_sha_is_not_matched(self):
        """The trailer git writes is always full length; a short one is something else."""
        self.assertEqual(
            ud.CHERRY_PICK_TRAILER.findall("(cherry picked from commit 2f23380)"), []
        )


class TheReport(unittest.TestCase):
    def test_nothing_pending_says_so_rather_than_printing_an_empty_list(self):
        text = ud.format_report(
            {"ref": "upstream/main", "base": "96541d3" + "0" * 33,
             "recorded_base": "96541d3", "record_matches": True, "commits": []}
        )
        self.assertIn("nothing pending", text)

    def test_a_stale_record_is_called_out(self):
        """UPSTREAM.md drifting is a finding, not a detail.

        If the fork has adopted commits without updating the record, every
        number below the header is measured from the wrong place.
        """
        text = ud.format_report(
            {"ref": "upstream/main", "base": "aaaaaaa" + "0" * 33,
             "recorded_base": "96541d3", "record_matches": False, "commits": []}
        )
        self.assertIn("UPSTREAM.md records", text)

    def test_a_matching_record_is_not_mentioned(self):
        text = ud.format_report(
            {"ref": "upstream/main", "base": "96541d3" + "0" * 33,
             "recorded_base": "96541d3", "record_matches": True, "commits": []}
        )
        self.assertNotIn("UPSTREAM.md records", text)

    def test_an_adopted_commit_is_named_rather_than_dropped(self):
        """Silently hiding it would answer the wrong question.

        Upstream stays ahead after an adoption, because a cherry-pick does not
        share history. Saying "already adopted" is what stops that looking like
        the tool having missed something.
        """
        text = ud.format_report(
            {"ref": "upstream/main", "base": "96541d3" + "0" * 33,
             "recorded_base": "96541d3", "record_matches": True, "commits": [],
             "adopted": [{"short": "2f23380", "subject": "light mode contrast"}]}
        )
        self.assertIn("already adopted: 2f23380", text)
        self.assertIn("light mode contrast", text)

    def test_a_report_without_an_adopted_key_still_formats(self):
        """`adopted` is read with .get, so an older survey dict does not crash it."""
        ud.format_report(
            {"ref": "upstream/main", "base": "a" * 40,
             "recorded_base": None, "record_matches": False, "commits": []}
        )

    def test_a_commit_prints_its_verdict_and_its_files(self):
        text = ud.format_report(
            {
                "ref": "upstream/main", "base": "96541d3" + "0" * 33,
                "recorded_base": "96541d3", "record_matches": True,
                "commits": [
                    {
                        "sha": "2f23380" + "0" * 33, "short": "2f23380",
                        "date": "2026-09-08", "subject": "light mode contrast",
                        "verdict": ud.VERDICT_PORT,
                        "files": [
                            {"path": "main.js", "relation": "extended",
                             "note": "shared", "conflicted": False, "hunks": 0},
                            {"path": "styles.css", "relation": "replaced",
                             "note": "owned", "conflicted": True, "hunks": 1},
                        ],
                    }
                ],
            }
        )
        self.assertIn("2f23380", text)
        self.assertIn("PORT", text)
        self.assertIn("light mode contrast", text)
        self.assertIn("conflict x1", text)


if __name__ == "__main__":
    unittest.main()
