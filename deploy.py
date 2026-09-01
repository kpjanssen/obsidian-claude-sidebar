#!/usr/bin/env python3
"""Deploy the built plugin bundle into the vault's plugin directory.

Tasks 2.1-2.3 of proj-flow's `obsidian-flow-plugin` change. Three rules:

  * The destination directory (`<vault>/.obsidian/plugins/<plugin id>/`) is
    an install location, not a workspace: this script writes fresh copies of
    the shipped files over whatever is there. It never opens a file already
    in the destination and edits it in place -- the source of record is
    always this repository, never the deployed copy.
  * `data.json` is where Obsidian stores this plugin's own settings once a
    person has used it. It is not in BUNDLE_FILES, and nothing in this
    script names it, reads it, or writes it. A redeploy therefore never
    resets a person's settings.
  * The upstream licence ships with every deploy (task 7.2/2.3), on the same
    terms as it ships in this repository: verbatim, alongside the code it
    covers.

Whether the deployed bundle is itself tracked by the vault's own git
repository is task 7.6 and is explicitly the vault owner's call, not this
script's -- see README.md "Deploying (fork)".

Usage:
    python deploy.py [--vault PATH]

Run `./build.sh` first if `terminal_pty.py` or `terminal_win.py` changed;
this script does not build, it only deploys what is already in `main.js`.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent

# Matches the fork's cross-vault convention recorded in the personal vault's
# CLAUDE.md ("the ai toolkit" / `.claude/`): the personal vault, not the
# work vault, and never assumed to be the only place a vault could live --
# hence the --vault override below.
DEFAULT_VAULT = Path.home() / "OneDrive" / "Vault"

# Exactly these files constitute the shipped bundle, copied whole every
# deploy. Nothing outside this list is ever touched at the destination --
# most importantly `data.json`, which is deliberately absent from it.
BUNDLE_FILES = ["manifest.json", "main.js", "styles.css", "LICENSE"]


def _plugin_id() -> str:
    manifest_path = REPO_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plugin_id = manifest.get("id")
    if not plugin_id:
        raise SystemExit(f"{manifest_path} has no \"id\" -- refusing to guess a destination directory")
    return plugin_id


def deploy(vault: Path) -> Path:
    dest = vault / ".obsidian" / "plugins" / _plugin_id()
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in BUNDLE_FILES:
        src = REPO_ROOT / name
        if not src.exists():
            raise SystemExit(f"missing {src} -- nothing was deployed")
        # copy2 replaces the destination file wholesale (content + mtime);
        # it never reads the deployed copy back to patch it, which is the
        # "never edit the vault copy in place" this script exists to keep.
        shutil.copy2(src, dest / name)
        copied.append(name)
    assert "data.json" not in copied  # task 2.2, asserted here as well as in the test suite
    return dest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT, help="vault root (default: %(default)s)")
    args = parser.parse_args(argv)

    if not args.vault.exists():
        print(f"vault not found: {args.vault}", file=sys.stderr)
        return 1

    dest = deploy(args.vault)
    print(f"deployed {', '.join(BUNDLE_FILES)} -> {dest}")
    print("data.json was not touched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
