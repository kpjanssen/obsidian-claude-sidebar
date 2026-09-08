# Claude Sidebar

Run Claude Code (and other agent CLIs) in your Obsidian sidebar.

Built by [Derek Larson](https://dtlarson.com) - [Pairs with Delegate commands →](https://delegatewithclaude.com/commands)

![Claude Sidebar](screenshot-obsidian.png)

## Features

- **Auto-launches your agent** - Your default CLI starts automatically
- **Multiple tabs** - Run multiple agents side by side
- **Embedded** - Full terminal with an agent in your Obsidian sidebar
- **Folder & file context menu** - Right-click any folder to open your agent in that directory, or a file to send it the path
- **YOLO mode** - Launch your agent with YOLO mode via right-click menus
- **Multi-backend** - Switch between Claude Code, Codex, Grok Build, OpenCode, Antigravity CLI, Kimi Code, GitHub Copilot, Cursor Agent, and Pi in settings, or via **Switch CLI provider…** in the command palette
- **Session header** - Each tab is named by the title Claude Code gives the conversation, with its working directory, git branch and session id underneath. Read live from the transcript, so a session that turns into a different session renames itself

## Requirements

- macOS, Linux, or Windows
- Python 3
- An agent CLI — [Claude Code](https://claude.com/claude-code) (default), or any other [supported backend](#features)

## Installation

### From Community Plugins (recommended)

Visit the plugin listing at [community.obsidian.md/plugins/claude-sidebar](https://community.obsidian.md/plugins/claude-sidebar) and click **Add to Obsidian**. Then in Obsidian, click **Install** → **Enable**.

**Windows:** See [Windows Setup](#windows-setup) below.

### Manual Installation (Mac/Linux)

In your vault folder, run:
```bash
mkdir -p .obsidian/plugins/claude-sidebar && cd .obsidian/plugins/claude-sidebar && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/main.js && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/manifest.json && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/styles.css
```

Then in Obsidian: Settings → Community Plugins → Refresh → Enable "Claude Sidebar".

### Manual Updating

In your vault folder, run:
```bash
cd .obsidian/plugins/claude-sidebar && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/main.js && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/manifest.json && \
  curl -LO https://github.com/derek-larson14/obsidian-claude-sidebar/releases/latest/download/styles.css
```

Then restart Obsidian or disable/re-enable the plugin.

### Windows Setup

After installing the plugin (via Community Plugins or manually), add Windows-specific dependencies:

1. Install Python 3 from [python.org](https://python.org)
2. Install pywinpty into the Python the plugin will use:
```bash
py -m pip install pywinpty
```

Use `py -m pip` (not just `pip`) to avoid installing into a different Python interpreter than the one the plugin selects. If you see "pywinpty not installed" in the sidebar after installing, the error message will print the exact interpreter path — install pywinpty into that one.

3. Pick whether to run your agent inside WSL or natively in `cmd.exe`. Configure in **Settings → Claude Sidebar → Shell** (Windows only — Linux/macOS always run `bash`):

| Option | Spawns | Path translation |
|--------|--------|------------------|
| cmd.exe (default) | `cmd.exe` | none |
| wsl.exe (WSL) | `wsl.exe` | Windows paths → Linux paths via `wslpath` |

Use `wsl.exe` when your agent CLI, Node, or git toolchain lives in a WSL distro. Vault paths sent to the agent (file path command, selection context, drag-drop, image paste, wikilink references) are converted to Linux form before reaching the CLI. Translation respects a custom `/etc/wsl.conf` `[automount]` root, so paths still resolve if your `C:\` mounts at `/c/` instead of `/mnt/c/`.

## Usage

https://github.com/user-attachments/assets/de98439a-8a1f-4a8a-9d02-44027d756462

- Click the bot icon in the left ribbon to open a tab
- Right-click the bot icon for YOLO mode, folder targeting, or resuming a conversation
- Right-click any folder for "Open here" or "Open here (YOLO)" - both name your current CLI
- Use Command Palette (`Cmd+P`) for all commands:
  - **Open terminal** / **New agent tab** / **Close agent tab**
  - **New agent tab (other CLI)…** - One-off tab on another CLI, default unchanged
  - **Switch default CLI provider…** - Change which CLI every new tab uses
  - **Toggle Focus: Editor ↔ Agent** - Quick switch between editor and agent
  - **Run agent from this folder** - Start the agent in the active file's directory
  - **Resume last conversation** - Pick up where you left off (`--continue`)
  - **Send file path to agent** / **Send selection to agent**
- Press `Shift+Enter` for multi-line input
- Set your own hotkeys in Settings → Hotkeys

## The session header (fork)

Three sidebar tabs open against one vault are three identical black rectangles.
Working out which is which means scrolling a transcript until something familiar
goes past, which is the problem this header exists to remove.

It shows what Claude Code already knows and writes down:

| line | source | absent when |
|---|---|---|
| the title | the last `{"type":"ai-title"}` record in the transcript | Claude has not named the session yet, drawn as *Untitled session* |
| the project | the transcript's own `cwd`, falling back to this tab's working directory | never |
| the branch | `gitBranch`, carried on every message record | the working directory is not a git repository |
| the session id | the id this tab claimed at launch, first eight characters, click to copy | the backend is not Claude Code, or the session was started with `--continue` |

Nothing is asked of the CLI and nothing is inferred. The title is Claude's own,
rewritten as a session's subject moves, so the header follows a session that
turns into a different session rather than pinning it to whatever it was first
asked. A session with no title yet is drawn as untitled rather than as a
truncated id -- an id standing where a name belongs reads as a name and is not
one.

The transcript is polled every two seconds and read incrementally: each poll
reads only the bytes added since the last one, and stops at the final newline
inside them, so neither a half-written record nor a multi-byte character is ever
split across two reads. On this machine's transcripts -- up to 8.4 MB -- a
4 KB-window replay produces byte-identical results to reading the whole file.

`test/flow-header.test.js` covers the path mapping, the env-var rules below, and
the scanner, including the one trap that matters: a message that merely quotes
`"ai-title"` is not a title.

### Environment variables in a synced settings file

The header resolves `CLAUDE_CONFIG_DIR` from the same parsed env block the shell
is launched with, because a header that resolved it differently would quietly
name a different conversation and look right doing it. That parser adds two
rules to upstream's `KEY=VALUE`, both additive -- a line with no prefix and no
token behaves exactly as before:

```
[username] KEY=VALUE   applies only on that Windows account
%USERPROFILE% or ~     expand to this machine's home directory
```

A vault that syncs between machines is read by both of them, so a literal path
written into `data.json` is correct on at most one. An account-scoped line is
*absent* on every other account rather than empty, so the other machine falls
back to what it already has instead of to a value describing a machine it is
not.

## Platform Support

| Platform | Status |
|----------|--------|
| macOS | ✅ Supported |
| Linux | ✅ Supported |
| Windows | ✅ Supported |

Want to use it on iOS or Android? See [Claude Anywhere](https://github.com/derek-larson14/claude-anywhere).

## How It Works

- [xterm.js](https://xtermjs.org/) for terminal emulation
- Python's built-in `pty` module for pseudo-terminal support (macOS/Linux)
- [pywinpty](https://github.com/andfoy/pywinpty) for Windows PTY support

## Development

The PTY scripts (`terminal_pty.py` for Unix, `terminal_win.py` for Windows) are embedded as base64 in `main.js` for Obsidian plugin directory compatibility. To rebuild after modifying:

```bash
./build.sh
```

## Deploying (fork)

This fork adds a read-only run-graph pane over [proj-flow](../proj-flow)'s
generated documents; see `UPSTREAM.md` for the lineage and `CLAUDE.md` for
what changed. Two things follow from being a fork rather than the upstream
plugin:

**The vault copy is deployed, never edited in place.** `deploy.py` copies
`manifest.json`, `main.js`, `styles.css` and `LICENSE` from this repository
into `<vault>/.obsidian/plugins/proj-flow/`, overwriting whatever is
there. It never opens a file already at the destination and patches it — the
source of record is always this repository. Making a change means editing
the file here, running `./build.sh` if the PTY wrappers changed, then
redeploying:

```bash
python deploy.py               # defaults to ~/OneDrive/Vault
python deploy.py --vault PATH  # or name the vault explicitly
```

`data.json` — where Obsidian stores this plugin's own settings once you've
used it — is deliberately not part of the deployed bundle. A redeploy never
touches it, so your settings survive.

**Whether the deployed bundle itself is tracked by the vault's own git
repository is an open decision for the vault owner**, not settled by this
script. Every other plugin currently installed in that vault (`dataview`,
`claude-sidebar`, and the rest) *is* tracked there, which is the existing
precedent, but a decision made for those plugins is not automatically a
decision made for this one — it is recorded as open rather than assumed.
Either way, the licence ships in the deployed copy: `deploy.py` always
copies `LICENSE` alongside the code it covers.

**Checking whether upstream moved.** `upstream_check.py` is read-only
against the GitHub API — it writes no file under any outcome — and reports
commits and releases published since the commit recorded in `UPSTREAM.md`.
An unreachable GitHub is reported as unavailable, never silently treated as
"nothing changed":

```bash
python upstream_check.py
```

**Deciding whether to take what upstream did.** `upstream_check.py` answers
whether upstream moved; `upstream_diff.py` answers whether this fork can take
it. For each pending commit it computes the merge with
`git merge-tree --write-tree` — which produces a tree and a conflict list
without touching the working tree, the index or any branch — and grades the
result per file:

| relation | meaning | a conflict here |
|---|---|---|
| **extended** | `main.js`, upstream's plugin with the fork's view added | the real cost; needs a decision |
| **replaced** | `manifest.json`, `styles.css`, `README.md`, `install.sh`, `.gitignore` — rewritten by the fork | expected on every release; informational |
| **untouched** | the fork has never changed it | applies cleanly |

That distinction is the point. Grading a `manifest.json` collision as a
blocker would cry wolf on literally every upstream commit, because the fork
carries its own id and name there by design.

```bash
python upstream_diff.py              # the report
python upstream_diff.py --show <sha> # what upstream actually changed in main.js
python upstream_diff.py --json
```

Exit status is 0 when nothing is pending, 2 when something wants a look, and 1
when the question could not be answered. Tests:
`python -m unittest test_upstream_diff`.

**Adopting one.** `git cherry-pick -x <sha>`, resolve the replaced files by
hand, `git cherry-pick --continue`. The `-x` matters: it writes
`(cherry picked from commit <sha>)` into the message, and that trailer is how
`upstream_diff.py` knows the commit is taken. Without it the commit is reported
as pending forever, because a cherry-pick does not move the merge-base — it
creates a new commit here rather than sharing history. Adopted commits are
listed as adopted rather than hidden, so upstream still being ahead does not
read as the tool having missed something. `UPSTREAM.md` records what each port
had to change.

## Contributing

Hit a bug or want to develop a new feature? Point your coding agent at `CLAUDE.md` in this repo. It will walk you through diagnosis, filing a report, or opening a PR.

## License

MIT
