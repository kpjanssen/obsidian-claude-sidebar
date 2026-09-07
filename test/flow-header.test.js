// What a terminal tab is called, and where that name is read from. `node
// test/flow-header.test.js`.
//
// Three defects this file exists to catch, all of them silent:
//
//   * A project slug that does not match the one Claude Code wrote. The header
//     then watches a path that will never exist and stays untitled forever,
//     which looks exactly like a session that has not been named yet.
//   * An account-scoped env line applied on the wrong account. That is the
//     failure the personal vault records in
//     `.system/Decisions/2026-08-09-claude-sidebar-config-dir.md`: a config
//     directory that cannot exist on the second machine, and a login prompt
//     every launch.
//   * A title taken from a line that merely *mentions* `"ai-title"`. Every
//     transcript of a session about this feature is full of them, so the check
//     is not "a title was found" but "the record it came from said it was one".
//
// Loaded out of `main.js` the same way `flow-face.test.js` loads the run-graph
// region, and for the same reason: a copy of these functions in a test would
// pass while the plugin ran something else.

const fs = require("fs");
const path = require("path");

const BEGIN = "// session header \u2014 BEGIN";
const END = "// ===== session header \u2014 END =====";

function loadRegion() {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const from = source.indexOf(BEGIN);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error("the session-header region is not in main.js; markers have moved");
  }
  // `path` is a module-scope binding in the plugin bundle, so the region has to
  // be given one here rather than closing over nothing.
  return new Function(
    "path",
    source.slice(from, to) +
      "\nreturn { flowProjectSlug, flowTranscriptPath, flowEnvVars, flowConfigDir," +
      " flowScanHeader, flowHeaderEqual };"
  )(path);
}

const F = loadRegion();

let failures = 0;
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error("FAIL: " + message);
  }
}

function equal(actual, expected, message) {
  check(
    actual === expected,
    message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")"
  );
}

function line(record) {
  return JSON.stringify(record) + "\n";
}

// ---- the slug is Claude Code's, not one that merely looks like it ----------
// Both of these are real directory names read off this machine, which is the
// only thing that makes them evidence.
equal(
  F.flowProjectSlug("C:\\Users\\koenjanssen2\\OneDrive\\Vault"),
  "C--Users-koenjanssen2-OneDrive-Vault",
  "a Windows vault path slugs the way Claude Code wrote it"
);
equal(F.flowProjectSlug("C:\\Repos"), "C--Repos", "a two-segment path keeps both hyphens");
equal(
  F.flowProjectSlug("C:\\Users\\KOENJA~1\\AppData"),
  "C--Users-KOENJA-1-AppData",
  "an 8.3 short name's tilde is a hyphen like any other non-alphanumeric"
);
equal(F.flowProjectSlug("/home/koen/vault"), "-home-koen-vault", "a POSIX path slugs too");
equal(F.flowProjectSlug(null), "", "a missing cwd slugs to empty rather than throwing");

// ---- a transcript path needs all three, and says so by returning null ------
equal(
  F.flowTranscriptPath("/cfg", "/home/k/v", "abc-123"),
  path.join("/cfg", "projects", "-home-k-v", "abc-123.jsonl"),
  "the transcript path is <config>/projects/<slug>/<id>.jsonl"
);
equal(F.flowTranscriptPath(null, "/home/k/v", "abc"), null, "no config dir, no path");
equal(F.flowTranscriptPath("/cfg", null, "abc"), null, "no cwd, no path");
equal(
  F.flowTranscriptPath("/cfg", "/home/k/v", null),
  null,
  "no session id, no path -- a --continue start and a non-Claude backend both land here"
);

// ---- env vars: upstream behaviour first, then the two added rules ----------
const HOME = "C:\\Users\\koenjanssen2";
const asKoen = raw => F.flowEnvVars(raw, { user: "koenjanssen2", home: HOME });
const asOther = raw => F.flowEnvVars(raw, { user: "kpkoe", home: "C:\\Users\\kpkoe" });

// An unprefixed line with no token must behave exactly as `shellEnv[key] = val`
// did before this function existed.
equal(asKoen("ENABLE_IDE_INTEGRATION=true").ENABLE_IDE_INTEGRATION, "true", "a plain line is unchanged");
equal(asKoen("# a comment\n\n  \nA=1").A, "1", "comments and blank lines are skipped");
equal(asKoen("FOO=a=b").FOO, "a=b", "only the first = separates; the value may contain more");
equal(asKoen("=novalue").hasOwnProperty(""), false, "a line with no key is dropped");

// The vault's actual data.json line, and the machine it is not for.
const REAL = "[koenjanssen2] CLAUDE_CONFIG_DIR=%USERPROFILE%\\.claude-personal";
equal(
  asKoen(REAL).CLAUDE_CONFIG_DIR,
  "C:\\Users\\koenjanssen2\\.claude-personal",
  "the scoped line applies on its own account, with %USERPROFILE% expanded"
);
equal(
  asOther(REAL).CLAUDE_CONFIG_DIR,
  undefined,
  "and is absent -- not empty -- on every other account, so that machine keeps its default"
);
equal(
  asKoen("[KOENJANSSEN2] A=1").A,
  "1",
  "the account match is case-insensitive; Windows account names are not case-sensitive"
);
equal(asKoen("~/.claude-work").hasOwnProperty("~/.claude-work"), false, "a line with no = is dropped");
equal(asKoen("A=~/x").A, HOME + "/x", "a leading ~ expands");
equal(asKoen("A=~x").A, "~x", "a tilde that is not a path segment does not");
equal(asKoen("A=a%userprofile%b").A, "a" + HOME + "b", "the token is case-insensitive");
equal(
  F.flowEnvVars("A=%USERPROFILE%", { user: "koenjanssen2", home: "" }).A,
  "%USERPROFILE%",
  "with no home to expand to, the value is left alone rather than blanked"
);

// ---- the config directory, resolved once for the shell and the header ------
equal(
  F.flowConfigDir({ CLAUDE_CONFIG_DIR: "/from/setting" }, { home: "/home/k", processEnv: { CLAUDE_CONFIG_DIR: "/from/env" } }),
  "/from/setting",
  "the plugin setting wins: it is what the shell will be launched with"
);
equal(
  F.flowConfigDir({}, { home: "/home/k", processEnv: { CLAUDE_CONFIG_DIR: "/from/env" } }),
  "/from/env",
  "an inherited CLAUDE_CONFIG_DIR is next"
);
equal(
  F.flowConfigDir({}, { home: "/home/k", processEnv: {} }),
  path.join("/home/k", ".claude"),
  "and the documented default last"
);
equal(F.flowConfigDir({}, { home: "", processEnv: {} }), null, "with no home at all there is no answer to give");

// ---- task 8.3/8.6: the fork invents no location of its own -----------------
// The pieces above assert the precedence and the shape separately. This states
// the property those pieces exist to guarantee, because that is the one a
// reader of the task list is actually asking about: a session started in the
// hosted terminal writes its transcript where Claude Code would have written it
// anyway. The fork hosts a terminal; it does not relocate what runs inside one.
const hosted = F.flowTranscriptPath(
  F.flowConfigDir({}, { home: "/home/k", processEnv: {} }),
  "/home/k/Vault",
  "abc-123"
);
equal(
  hosted,
  path.join("/home/k", ".claude", "projects", "-home-k-Vault", "abc-123.jsonl"),
  "with nothing configured, the transcript lands in the ordinary profile location"
);
for (const invented of ["claude-sidebar", "proj-flow", "plugins", ".obsidian"]) {
  check(
    hosted.indexOf(invented) === -1,
    "the hosted transcript path contains nothing plugin-specific: " + invented
  );
}
// And when the operator *does* redirect it, the redirection is theirs and is
// obeyed exactly -- the fork neither ignores it nor decorates it.
equal(
  F.flowTranscriptPath(
    F.flowConfigDir({ CLAUDE_CONFIG_DIR: "/elsewhere" }, { home: "/home/k", processEnv: {} }),
    "/home/k/Vault",
    "abc-123"
  ),
  path.join("/elsewhere", "projects", "-home-k-Vault", "abc-123.jsonl"),
  "a configured profile is obeyed exactly, with nothing added to it"
);

// ---- scanning a chunk of transcript ---------------------------------------
const EMPTY = { title: null, cwd: null, branch: null };

const chunk =
  line({ type: "user", cwd: "C:\\Vault", gitBranch: "master", message: { role: "user" } }) +
  line({ type: "ai-title", aiTitle: "Lost sessions recovery", sessionId: "x" }) +
  line({ type: "assistant", cwd: "C:\\Vault", gitBranch: "master" }) +
  line({ type: "ai-title", aiTitle: "Obsidian plugin header implementation", sessionId: "x" });
const scanned = F.flowScanHeader(chunk, EMPTY);
equal(scanned.title, "Obsidian plugin header implementation", "the last ai-title wins; a rename is a new record");
equal(scanned.cwd, "C:\\Vault", "the cwd comes off a message record");
equal(scanned.branch, "master", "so does the branch");

// The trap. This is what a transcript of *this* session looks like, and a
// header that read it would name the tab after a quoted fragment of itself.
const mention = F.flowScanHeader(
  line({ type: "assistant", cwd: "C:\\Vault", message: { content: 'grep for "ai-title" in the jsonl' } }),
  EMPTY
);
equal(mention.title, null, "a record that merely quotes ai-title is not a title");
equal(mention.cwd, "C:\\Vault", "though it is still perfectly good for the cwd");

// State carries forward: a poll that gains nothing must not blank the header.
const carried = F.flowScanHeader("", { title: "Held", cwd: "C:\\Vault", branch: "master" });
equal(carried.title, "Held", "an empty chunk keeps the title");
equal(carried.cwd, "C:\\Vault", "and the cwd");
equal(carried.branch, "master", "and the branch");

equal(
  F.flowScanHeader(line({ type: "ai-title", aiTitle: "  spread   over\nlines  " }), EMPTY).title,
  "spread over lines",
  "a title is collapsed to one line, because it is drawn on one"
);
equal(
  F.flowScanHeader(line({ type: "ai-title", aiTitle: "   " }), { title: "Held", cwd: null, branch: null }).title,
  "Held",
  "an empty title does not replace a real one"
);
equal(
  F.flowScanHeader("not json at all\n" + line({ type: "ai-title", aiTitle: "After" }), EMPTY).title,
  "After",
  "a corrupt line is skipped rather than fatal -- the file is written by another process"
);
equal(
  F.flowScanHeader(line({ type: "user", cwd: "C:\\Vault", gitBranch: "" }), EMPTY).branch,
  null,
  "an empty gitBranch is absent, not an empty branch name: a cwd outside a repo reports one"
);

// ---- the equality that decides whether to redraw ---------------------------
check(F.flowHeaderEqual(EMPTY, { title: null, cwd: null, branch: null }), "two empty states are equal");
check(
  !F.flowHeaderEqual({ title: "a", cwd: null, branch: null }, { title: "b", cwd: null, branch: null }),
  "a changed title is not equal, or the header would never redraw"
);
check(
  !F.flowHeaderEqual({ title: "a", cwd: null, branch: null }, { title: "a", cwd: null, branch: "master" }),
  "a branch appearing counts as a change too"
);

console.log((checks - failures) + "/" + checks + " header checks passed");
if (failures) process.exit(1);
