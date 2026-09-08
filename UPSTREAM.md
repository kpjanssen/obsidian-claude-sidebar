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

### `6a31bae` — 1.10.0, not adopted, and the reason is not the merge

Read on 2026-09-08. Both `main.js` conflicts are this fork's own rebranding
colliding with an upstream refactor, and neither is a design disagreement:

- **PATH resolution.** Upstream moved the login-shell / PowerShell probe out of
  `TerminalView` into a cached `resolveUserPath()` on the plugin. The probe is
  the fork's own code only in the sense that the fork inherited it at the fork
  point — `git log -S` puts it in upstream's `96541d3` (1.9.5) — and the only
  thing this fork changed in that block is the `console.warn` label,
  `[Claude Sidebar]` to `[Flow Terminal]`. Upstream's version is strictly
  better here: identical logic, cached for the session instead of re-probed on
  every terminal, and reused by `installedBackends()`.
- **Command ids.** This fork prefixes every command id with `flow-`. Upstream
  inserted `open-agent-in-project` next to `new-tab-with-cli-provider`, so the
  hunk lands mid-list. Take both, prefix both.

So the merge is mechanical. What is open is whether the feature is wanted: the
command opens a CLI in **any folder on the machine**, browsed to and then
remembered in a recents list, and this plugin has no launch-side boundary
guard — the refusal added on 2026-09-07 checks the *profile a document was
extracted from*, not the directory a terminal starts in. The professional vault
is a folder like any other to a file picker. Adopting the refactor without the
command is possible and loses nothing; adopting the command is a decision about
the cross-vault boundary, which is not a merge question.

## Upstream License

The upstream repository is licensed under the MIT License. The original LICENSE file and copyright notice are retained verbatim in this repository.

**Original Copyright:** Copyright (c) 2025 Derek Larson

See the `LICENSE` file in this repository for the complete license text.
