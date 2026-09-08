# Upstream Fork Lineage

This repository is a fork of the Obsidian Claude Sidebar plugin.

**Upstream Repository:** https://github.com/derek-larson14/obsidian-claude-sidebar

**Upstream Commit:** `96541d38446611017ad8d6d51a731c96a22aa8ea`

**Fork Date:** 2026-08-31

## Adopted upstream commits

**Upstream Commit** above is the fork point and does not move when a commit is
adopted. A cherry-pick creates a new commit on this side rather than sharing
history, so `git merge-base HEAD upstream/main` stays where it is by design;
`upstream_diff.py` reports drift only when the two genuinely disagree.

What has been taken is recorded by `git cherry-pick -x`, which writes
`(cherry picked from commit <sha>)` into the message of the commit it creates.
That is the record `upstream_diff.py` reads. It is written by the act of
adopting rather than remembered afterwards, which is the reason it is not a
list kept here by hand. To see it: `git log --grep="cherry picked from"`.

| upstream | adopted | port |
|---|---|---|
| `2f23380` — 1.10.1: light mode contrast and terminal scrollbar | 2026-09-08 | `main.js` auto-merged. `manifest.json` kept ours entirely — upstream's change there was only its own version bump, which this fork does not track. `styles.css` hand-ported: the rules are upstream's verbatim, with `.vault-terminal-host` rewritten to `.flow-terminal-host`, which is the class this fork rescopes to. |

Not adopted, and open: `6a31bae` — 1.10.0, "open an agent in a project outside
the vault". It conflicts in `main.js` across two hunks, which is the one kind
of collision this fork cannot resolve mechanically. Run `python
upstream_diff.py --show 6a31bae` to read it.

## Upstream License

The upstream repository is licensed under the MIT License. The original LICENSE file and copyright notice are retained verbatim in this repository.

**Original Copyright:** Copyright (c) 2025 Derek Larson

See the `LICENSE` file in this repository for the complete license text.
