// Session cycling in the docked view. `node test/flow-session-cycling.test.js`.
//
// Covers what the picker decides (which rows survive, which is active, what is
// refused, what is typed into the terminal) and drives the view's own methods
// with fakes: a fake spawner in place of proj-cli, a stub Menu/Modal/Notice,
// and a recording startShell. No Claude Code process is started and no
// transcript is read by the plugin: the only source is what a fake `proj-cli
// list --json` prints.
//
// Loaded out of main.js rather than reimplemented, for the reason every
// sibling file in this directory gives.

const fs = require("fs");
const os = require("os");
const path = require("path");

const BEGIN = "var FLOW_RESERVED_DIRNAME";
const END = "// ===== proj-flow run-graph view — END =====";
const CYCLE_BEGIN = "  // --- session cycling ---";
const CYCLE_END = "  getThemeColors() {";

const whole = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const region = whole.slice(whole.indexOf(BEGIN), whole.indexOf(END));
const methods = whole.slice(whole.indexOf(CYCLE_BEGIN), whole.indexOf(CYCLE_END, whole.indexOf(CYCLE_BEGIN)));
if (!region || !methods) throw new Error("markers moved in main.js");
// startShell up to and including the clear that follows stopShell(): everything
// that decides whether an attach is refused, without the PTY that follows.
const SHELL_BEGIN = "  startShell(workingDir = null";
const shellStart = whole.indexOf(SHELL_BEGIN);
const shellGuards = whole.slice(shellStart, whole.indexOf("    const defaultDir", shellStart)) + "  }\n";
if (shellStart === -1 || shellGuards.indexOf("this.stopShell()") === -1) throw new Error("startShell moved in main.js");

globalThis.__notices = [];
globalThis.__menus = [];
globalThis.__modals = [];

const stub =
  "var import_obsidian = {" +
  " Modal: (function () { function M(app) { this.app = app; this.contentEl = globalThis.__el(); this.buttons = []; }" +
  "   M.prototype.open = function () { globalThis.__modals.push(this); }; M.prototype.close = function () { this.closed = true; }; return M; })()," +
  " Menu: (function () { function Mn() { this.items = []; globalThis.__menus.push(this); }" +
  "   Mn.prototype.addItem = function (cb) { const it = { title: '', checked: false, disabled: false," +
  "     setTitle(t) { this.title = t; return this; }, setChecked(c) { this.checked = c; return this; }," +
  "     setDisabled(d) { this.disabled = d; return this; }, onClick(f) { this.click = f; return this; } };" +
  "     cb(it); this.items.push(it); return this; };" +
  "   Mn.prototype.showAtPosition = function (p) { this.shownAt = p; }; return Mn; })()," +
  " Notice: function (m) { globalThis.__notices.push(String(m)); } };\n";

// A minimal element that records what was created on it.
globalThis.__el = function () {
  const el = {
    children: [],
    createEl(tag, opts) { const c = globalThis.__el(); c.tag = tag; c.opts = opts || {}; c.text = (opts && opts.text) || ""; el.children.push(c); return c; },
    createDiv(opts) { return el.createEl("div", opts); },
    addEventListener(type, fn) { el.handlers = el.handlers || {}; el.handlers[type] = fn; }
  };
  return el;
};

const F = new Function(
  "fs",
  "path",
  "import_child_process",
  stub +
    region +
    "\nclass Cycler {\n" + methods + "\n}\n" +
    "\nclass Shell {\n" + methods + shellGuards + "}\n" +
    "return { Cycler, Shell, flowSessionResumeProblem, flowParseSessionList, flowResumeShellCommand, flowAttachPlan," +
    " flowSubagentChildren, flowSessionEntries, flowCycleTarget, flowSessionLabel, flowListSessions," +
    " flowSessionListArgv, flowResolveProjCliRepoPath, flowProjCliRepoLooksReal, FLOW_PROJ_CLI_REPO_ENV_VAR," +
    " FLOW_SESSION_ID_RE, flowWorkVaultProblem, flowResetPythonCache };"
)(fs, path, require("child_process"));

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
    JSON.stringify(actual) === JSON.stringify(expected),
    message + " -- expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)
  );
}

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const VAULT = "C:\\Users\\koen\\OneDrive\\Vault";
const WORK = "C:\\Users\\koen\\OneDrive - Some Employer B.V.\\Vault";

function row(id, extra) {
  return Object.assign(
    { session_id: id, title: "t-" + id.slice(0, 1), cwd: VAULT, project: "Vault", slug: "slug", age_seconds: 600 },
    extra || {}
  );
}

// ---- argv and paths --------------------------------------------------------

equal(F.flowSessionListArgv(7), ["-m", "proj_cli", "list", "--json", "--limit", "7"], "list argv is proj_cli list --json, nothing else");
check(F.flowSessionListArgv().every((a) => !/claude/i.test(a)), "the list argv never names claude");
equal(F.flowResumeShellCommand(A), "proj-cli resume " + A, "the attach command is proj-cli resume <id>");
check(!/claude/i.test(F.flowResumeShellCommand(A)), "the attach command builds no claude argv and never names claude.exe");
equal(F.flowResumeShellCommand("abc; rm -rf /"), null, "an id that is not a uuid never reaches a shell");
equal(F.flowResumeShellCommand("$(evil)"), null, "shell metacharacters in an id are refused");
equal(F.flowResumeShellCommand(null), null, "no id, no command");

const exists = (set) => (p) => set.includes(p);
equal(
  F.flowResolveProjCliRepoPath({ PROJ_CLI_REPO_PATH: "D:\\x\\proj-cli" }, exists(["D:\\x\\proj-cli\\proj_cli\\__main__.py"])),
  "D:\\x\\proj-cli",
  "the repo is found from the environment when its entry point is there"
);
equal(F.flowResolveProjCliRepoPath({ PROJ_CLI_REPO_PATH: "D:\\x\\proj-cli" }, exists([])), null, "a directory without proj_cli/__main__.py is not proj-cli");
equal(F.flowResolveProjCliRepoPath({}, exists([])), null, "nothing found means the picker is absent");

// ---- refusals --------------------------------------------------------------

check(F.flowSessionResumeProblem(row(A)) === null, "an ordinary personal session is resumable");
check(!!F.flowSessionResumeProblem(row(A, { cwd: WORK })), "a session in the professional vault is refused");
check(/professional vault/.test(F.flowSessionResumeProblem(row(A, { cwd: WORK }))), "and the refusal says why");
check(!!F.flowSessionResumeProblem(row(A, { cwd: "C:\\Users\\koen\\onedrive - other\\deep\\repo" })), "the marker is matched at any depth");
check(!!F.flowSessionResumeProblem(row(A, { cwd: null })), "no recorded directory is refused, not guessed");
check(!!F.flowSessionResumeProblem(row("not-a-uuid")), "a bad id is refused");
check(!!F.flowSessionResumeProblem(null), "a null row is refused");
check(!!F.flowAttachPlan(row(A, { cwd: WORK })).problem, "the attach plan carries the refusal");
equal(F.flowAttachPlan(row(A)).command, "proj-cli resume " + A, "the attach plan carries the command");

// ---- parsing the list ------------------------------------------------------

{
  const out = JSON.stringify([row(A), row(B, { cwd: WORK }), row(C)]);
  const parsed = F.flowParseSessionList(out);
  equal(parsed.rows.map((r) => r.session_id), [A, C], "work rows are dropped from the list even if proj-cli passed one");
  equal(parsed.refused, 1, "and counted");
  check(parsed.error === null, "no error on a good list");
  check(F.flowParseSessionList("no sessions found").error !== null, "the table's prose is an error, not an empty list");
  check(F.flowParseSessionList("{}").error !== null, "a non-array is an error");
  equal(F.flowParseSessionList("[]").rows, [], "an empty array is an empty list");
}

// ---- subagents from the run graph -------------------------------------------

function graph(sessionId, dispatches) {
  const nodes = [{ "graph.node.id": "session:" + sessionId, "graph.node.name": "S", kind: "session", ordinal: 0 }];
  for (const d of dispatches) {
    nodes.push({
      "graph.node.id": d.id,
      "graph.node.name": d.name,
      "graph.node.parent_id": d.parent || "session:" + sessionId,
      kind: d.kind || "dispatch",
      agent_type: d.agent_type,
      ordinal: d.ordinal || 0
    });
  }
  return { schema_version: 2, kind: "run", nodes, counts: { nodes: nodes.length } };
}

{
  const doc = graph(A, [
    { id: "dispatch:1", name: "Explore repo", agent_type: "Explore", ordinal: 1 },
    { id: "dispatch:2", name: "nested", parent: "dispatch:1", ordinal: 2 },
    { id: "join:1", name: "a join", kind: "join", ordinal: 3 }
  ]);
  const kids = F.flowSubagentChildren(doc);
  equal(kids.map((k) => [k.name, k.depth]), [["Explore repo", 1], ["nested", 2]], "dispatches nest by recorded parent; other kinds are not subagents");
  equal(F.flowSubagentChildren(null), [], "no document, no children");
  equal(F.flowSubagentChildren({ nodes: [] }), [], "a document with no session node has no children");

  const entries = F.flowSessionEntries([row(A, { age_seconds: 30 }), row(B)], B, (id) => (id === A ? doc : null));
  equal(entries.map((e) => [e.sessionId, e.active, e.live]), [[A, false, true], [B, true, false]], "active is the tab's own id; live is a recent transcript");
  equal(entries[0].children.length, 2, "children hang off their own session");
  equal(entries[1].children, [], "a session with no graph has no children");

  const foreign = Object.assign({}, doc, { profile: "C:\\Users\\koen\\.claude" });
  const refused = F.flowSessionEntries([row(A)], null, () => foreign);
  equal(refused[0].children, [], "a graph the pane itself would refuse contributes no children");

  const labels = entries.map(F.flowSessionLabel);
  check(labels[0].startsWith("\u25cf "), "a live session is marked");
  check(labels[1].endsWith("(active)"), "the active session is marked");
}

// A parallel dispatch is parented under an orchestrator node ("fan-out of N"),
// as proj-flow's extract.py writes it. The picker must see through it.
{
  const doc = graph(A, [
    { id: "orch:1", name: "fan-out of 3", kind: "orchestrator", ordinal: 1 },
    { id: "d:1", name: "one", parent: "orch:1", ordinal: 2 },
    { id: "d:2", name: "two", parent: "orch:1", ordinal: 3 },
    { id: "d:3", name: "three", parent: "orch:1", ordinal: 4 },
    { id: "d:2a", name: "two-child", parent: "d:2", ordinal: 5 },
    { id: "d:solo", name: "solo", ordinal: 6 }
  ]);
  const kids = F.flowSubagentChildren(doc);
  equal(
    kids.map((k) => [k.name, k.depth]),
    [["one", 1], ["two", 1], ["two-child", 2], ["three", 1], ["solo", 1]],
    "dispatches under a fan-out orchestrator are listed at the session's depth; the orchestrator is not drawn"
  );
  const deep = graph(A, [
    { id: "orch:1", name: "fan-out of 1", kind: "orchestrator", ordinal: 1 },
    { id: "join:1", name: "j", kind: "join", parent: "orch:1", ordinal: 2 },
    { id: "d:1", name: "under two pass-throughs", parent: "join:1", ordinal: 3 }
  ]);
  equal(F.flowSubagentChildren(deep).map((k) => k.name), ["under two pass-throughs"], "any number of pass-through nodes is walked");
}

// ---- cycling ---------------------------------------------------------------

{
  const e = F.flowSessionEntries([row(A), row(B), row(C)], null, null);
  equal(F.flowCycleTarget(e, B, 1).sessionId, C, "next moves forward");
  equal(F.flowCycleTarget(e, B, -1).sessionId, A, "previous moves back");
  equal(F.flowCycleTarget(e, C, 1).sessionId, A, "next wraps");
  equal(F.flowCycleTarget(e, A, -1).sessionId, C, "previous wraps");
  equal(F.flowCycleTarget(e, "unlisted", 1).sessionId, A, "an unlisted active session goes forward to the first");
  equal(F.flowCycleTarget(e, "unlisted", -1).sessionId, C, "and backward to the last");
  equal(F.flowCycleTarget([], A, 1), null, "nothing to cycle to");

  // The list is ordered by recency and an attach reshuffles it. Cycling must
  // still walk A -> B -> C, not bounce between A and B.
  const recency1 = F.flowSessionEntries([row(A), row(B), row(C)], A, null);
  const first = F.flowCycleTarget(recency1, A, 1).sessionId;
  const recency2 = F.flowSessionEntries([row(first), row(A), row(C)], first, null);
  equal([first, F.flowCycleTarget(recency2, first, 1).sessionId], [B, C], "cycling reaches the third session after the list reshuffles");
  const shuffled = F.flowSessionEntries([row(C), row(A), row(B)], B, null);
  equal(F.flowCycleTarget(shuffled, B, 1).sessionId, C, "the order does not depend on the order the list arrived in");
}

// ---- the view, with fakes --------------------------------------------------

function fakeView(overrides) {
  const view = new F.Cycler();
  view.app = { vault: { adapter: { basePath: overrides.base || "" } } };
  view.sessionId = overrides.sessionId || null;
  view.proc = overrides.proc || null;
  view.term = { reset() { view.resets = (view.resets || 0) + 1; } };
  view.headerEl = { getBoundingClientRect: () => ({ left: 5, bottom: 9 }) };
  view.switchButtonEl = null;
  view.starts = [];
  view.startShell = function () { view.starts.push(Array.from(arguments)); };
  view.getBackendKey = () => overrides.backend || "claude";
  view.renderSessionHeader = function () {};
  view.sessionCyclingAvailable = () => true;
  return view;
}

function fakeSpawn(stdout, code) {
  const calls = [];
  const spawn = (cmd, argv, options) => {
    calls.push({ cmd, argv, options });
    return Promise.resolve({ code: code === undefined ? 0 : code, stdout, stderr: code ? "boom" : "" });
  };
  spawn.calls = calls;
  return spawn;
}

const pending = [];
pending.push(
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cycle-"));
    // The run graph flow wrote for session A, under <vault>/_flow/<project>/.
    const projectDir = path.join(tmp, "_flow", "Vault");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, A + ".graph.json"),
      JSON.stringify(graph(A, [{ id: "dispatch:1", name: "Explore repo", agent_type: "Explore", ordinal: 1 }]))
    );
    const prev = process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR];
    const repo = path.join(tmp, "proj-cli");
    fs.mkdirSync(path.join(repo, "proj_cli"), { recursive: true });
    fs.writeFileSync(path.join(repo, "proj_cli", "__main__.py"), "");
    process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR] = repo;

    try {
      // list -> entries, through the fake spawner
      const spawn = fakeSpawn(JSON.stringify([row(A, { age_seconds: 20 }), row(B), row(C, { cwd: WORK })]));
      const view = fakeView({ base: tmp, sessionId: B });
      const loaded = await view.loadSessionEntries({ spawn, pythonCmd: "python" });
      equal(spawn.calls.length, 1, "one subprocess is spawned to list");
      equal(spawn.calls[0].cmd, "python", "it is python, never claude");
      equal(spawn.calls[0].argv.slice(0, 4), ["-m", "proj_cli", "list", "--json"], "it runs proj_cli list --json");
      equal(spawn.calls[0].options.cwd, repo, "from the proj-cli checkout");
      equal(loaded.entries.map((e) => e.sessionId), [A, B], "the work session is not in the list");
      equal(loaded.refused, 1, "and its refusal is counted");
      equal(loaded.entries[0].children.map((c) => c.name), ["Explore repo"], "subagents come from the run graph on disk");
      equal(loaded.entries.map((e) => e.active), [false, true], "the active session is the tab's session");

      // list failure surfaces, never an empty pretend-list
      const failed = await fakeView({ base: tmp }).loadSessionEntries({ spawn: fakeSpawn("", 2), pythonCmd: "python" });
      check(/proj-cli list failed/.test(failed.error || ""), "a failing proj-cli is reported as an error");
      const junk = await fakeView({ base: tmp }).loadSessionEntries({ spawn: fakeSpawn("no sessions found"), pythonCmd: "python" });
      check(!!junk.error, "prose instead of JSON is an error");

      // the dropdown
      globalThis.__menus.length = 0;
      const shown = fakeView({ base: tmp, sessionId: B });
      shown.loadSessionEntries = () => view.loadSessionEntries({ spawn, pythonCmd: "python" });
      await shown.openSessionMenu();
      const menu = globalThis.__menus[0];
      equal(menu.items.map((i) => [i.checked, i.disabled]), [[false, false], [false, true], [true, false]], "menu: session, its child (inert), then the checked active one");
      check(menu.items[1].title.indexOf("Explore repo") !== -1, "the subagent is drawn under its session");
      check(menu.items[0].title.startsWith("\u25cf "), "a live session is marked in the menu");
      check(menu.items[2].title.endsWith("(active)"), "the active session is marked in the menu");
      equal(menu.shownAt, { x: 5, y: 9 }, "the menu opens under the header");

      // picking one attaches through startShell with the proj-cli command's inputs
      const picker = fakeView({ base: tmp, sessionId: B });
      menu.items[0].click();
      picker.switchToSession(loaded.entries[0]);
      equal(picker.starts.length, 1, "a pick starts the terminal once");
      equal(picker.starts[0][3], { sessionId: A, cwd: VAULT }, "with the picked id and its directory as the attach");
      check(!picker.resets, "switchToSession does not clear the terminal itself; startShell does, after its guards");

      // the active session is a no-op
      const same = fakeView({ base: tmp, sessionId: B });
      same.switchToSession(loaded.entries[1]);
      equal(same.starts.length, 0, "picking the active session does nothing");

      // a running process is not killed without asking
      globalThis.__modals.length = 0;
      const busy = fakeView({ base: tmp, sessionId: B, proc: { killed: false } });
      busy.switchToSession(loaded.entries[0]);
      equal(busy.starts.length, 0, "a running tab is not switched before the dialog is answered");
      equal(globalThis.__modals.length, 1, "a confirm dialog opens");
      const buttons = globalThis.__modals[0].contentEl.children.filter((c) => c.children.length).pop().children;
      buttons.find((b) => b.text === "Cancel").handlers.click();
      equal(busy.starts.length, 0, "cancel leaves the session alone");
      buttons.find((b) => b.text === "Switch").handlers.click();
      equal(busy.starts.length, 1, "confirm attaches");

      // a work session is refused on resume even if it reached the menu
      globalThis.__notices.length = 0;
      const guarded = fakeView({ base: tmp });
      guarded.switchToSession({ sessionId: A, title: "x", cwd: WORK });
      equal(guarded.starts.length, 0, "a work session is never attached");
      check(/professional vault/.test(globalThis.__notices.join("|")), "and the operator is told why");

      // keyboard cycle
      const cycler = fakeView({ base: tmp, sessionId: A });
      cycler.loadSessionEntries = () => view.loadSessionEntries({ spawn, pythonCmd: "python" });
      await cycler.cycleSession(1);
      equal(cycler.starts[0][3].sessionId, B, "next attaches the following session");
      const backwards = fakeView({ base: tmp, sessionId: A });
      backwards.loadSessionEntries = () => view.loadSessionEntries({ spawn, pythonCmd: "python" });
      await backwards.cycleSession(-1);
      equal(backwards.starts[0][3].sessionId, B, "previous wraps to the last");

      // ---- robustness: list failure modes ----
      const timedOut = await fakeView({ base: tmp }).loadSessionEntries({
        spawn: async () => ({ code: null, stdout: "", stderr: "timed out after 15s and was stopped" }),
        pythonCmd: "python"
      });
      check(/proj-cli list failed: timed out/.test(timedOut.error || ""), "a timeout (code null) is reported with its message, not as an empty list");
      equal(timedOut.entries, [], "and yields no entries");
      const rejected = await fakeView({ base: tmp }).loadSessionEntries({
        spawn: () => Promise.reject(new Error("spawn python ENOENT")),
        pythonCmd: "python"
      });
      check(/ENOENT/.test(rejected.error || ""), "a rejecting spawner becomes an error result, not an unhandled rejection");
      const threw = await fakeView({ base: tmp }).loadSessionEntries({
        spawn: () => { throw new Error("sync boom"); },
        pythonCmd: "python"
      });
      check(/sync boom/.test(threw.error || ""), "a throwing spawner becomes an error result too");
      const spawnedNone = fakeSpawn("[]");
      const noPython = await F.flowListSessions({ projCliRepoPath: repo, pythonCmd: null }, { spawn: spawnedNone });
      check(/Python was not found/.test(noPython.error || ""), "no python interpreter is a clear error");
      equal(spawnedNone.calls.length, 0, "and nothing is spawned without one");
      // the menu surfaces a list error instead of throwing
      globalThis.__notices.length = 0;
      globalThis.__menus.length = 0;
      const erroring = fakeView({ base: tmp });
      const realLoad = erroring.loadSessionEntries;
      erroring.loadSessionEntries = () => realLoad.call(erroring, { spawn: () => Promise.reject(new Error("nope")), pythonCmd: "python" });
      await erroring.openSessionMenu();
      check(/nope/.test(globalThis.__notices.join("|")) && globalThis.__menus.length === 0, "a rejected list shows a notice and no menu");
      equal(erroring._sessionListBusy, false, "and the busy flag is released after an error");

      // a checkout path with spaces reaches the spawner as one cwd, never joined into argv
      const spaced = path.join(tmp, "my repos", "proj cli");
      fs.mkdirSync(path.join(spaced, "proj_cli"), { recursive: true });
      fs.writeFileSync(path.join(spaced, "proj_cli", "__main__.py"), "");
      process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR] = spaced;
      const spacedSpawn = fakeSpawn("[]");
      await fakeView({ base: tmp }).loadSessionEntries({ spawn: spacedSpawn, pythonCmd: "python" });
      equal(spacedSpawn.calls[0].options.cwd, spaced, "a repo path with spaces is passed whole as cwd");
      check(spacedSpawn.calls[0].argv.every((a) => a.indexOf(spaced) === -1 && a.indexOf(" ") === -1), "and appears in no argv element");
      process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR] = repo;

      // ---- a non-claude tab is refused before the dialog, and nothing is cleared ----
      globalThis.__modals.length = 0;
      globalThis.__notices.length = 0;
      const other = fakeView({ base: tmp, sessionId: B, proc: { killed: false }, backend: "codex" });
      other.switchToSession(loaded.entries[0]);
      equal(globalThis.__modals.length, 0, "no confirm dialog is offered for an attach that would be refused");
      check(/another provider/.test(globalThis.__notices.join("|")), "the operator is told why");
      equal([other.starts.length, other.resets || 0], [0, 0], "nothing started and nothing cleared");

      // ---- a view closed during the list spawn does nothing afterwards ----
      const deferred = () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        const spawn = (cmd, argv, options) => { spawn.calls.push({ cmd, argv, options }); return gate; };
        spawn.calls = [];
        spawn.release = (stdout) => release({ code: 0, stdout, stderr: "" });
        return spawn;
      };
      const listJson = JSON.stringify([row(A), row(B), row(C)]);
      {
        const slow = deferred();
        const closing = fakeView({ base: tmp, sessionId: A });
        closing.loadSessionEntries = () => view.loadSessionEntries({ spawn: slow, pythonCmd: "python" });
        globalThis.__menus.length = 0;
        const pendingCycle = closing.cycleSession(1);
        const pendingMenu = closing.openSessionMenu();
        closing._isDisposed = true;
        slow.release(listJson);
        await Promise.all([pendingCycle, pendingMenu]);
        equal(closing.starts.length, 0, "a cycle resolving after the view closed starts no terminal");
        equal(globalThis.__menus.length, 0, "and a menu resolving after close is not opened");
        equal(closing._sessionListBusy, false, "the busy flag is released once the spawn settles");

        // a confirm answered after close does not attach either
        globalThis.__modals.length = 0;
        const late = fakeView({ base: tmp, sessionId: B, proc: { killed: false } });
        late.switchToSession(loaded.entries[0]);
        late._isDisposed = true;
        globalThis.__modals[0].contentEl.children.filter((c) => c.children.length).pop().children.find((b) => b.text === "Switch").handlers.click();
        equal(late.starts.length, 0, "a Switch confirmed after close attaches nothing");
      }

      // ---- overlapping presses: one list spawn, one switch ----
      {
        const slow = deferred();
        const twice = fakeView({ base: tmp, sessionId: A });
        twice.loadSessionEntries = () => view.loadSessionEntries({ spawn: slow, pythonCmd: "python" });
        globalThis.__menus.length = 0;
        const one = twice.cycleSession(1);
        const two = twice.cycleSession(1);
        const three = twice.openSessionMenu();
        slow.release(listJson);
        await Promise.all([one, two, three]);
        equal(slow.calls.length, 1, "three overlapping requests spawn proj-cli once");
        equal(twice.starts.length, 1, "and switch once");
        equal(globalThis.__menus.length, 0, "the overlapping menu request is dropped, not stacked");
        await twice.cycleSession(1);
        equal(slow.calls.length, 2, "a later request, after the first settled, runs normally");
      }
    } finally {
      if (prev === undefined) delete process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR];
      else process.env[F.FLOW_PROJ_CLI_REPO_ENV_VAR] = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })()
);

// ---- startShell's attach path (structure) ------------------------------------
// startShell needs a PTY and cannot run here; what can be pinned is the order of
// its guards, which is the part that must not drift.
{
  const from = whole.indexOf("  startShell(workingDir = null");
  const body = whole.slice(from, whole.indexOf("  stopShell() {", from));
  const refuse = body.indexOf("attachPlan.problem");
  const stop = body.indexOf("this.stopShell()");
  check(refuse !== -1 && stop !== -1 && refuse < stop, "an attach is refused before the running shell is stopped");
  check(body.indexOf("flowWorkVaultProblem(cwd)") !== -1, "the terminal directory is still boundary-checked on every start");
  check(/attachPlan \? attachPlan\.command/.test(body), "the attach runs the proj-cli command as its chain");
  check(
    !body.split("\n").some((l) => /attachPlan/.test(l) && /--session-id|--resume|claude\.exe/.test(l) && !/^\s*\/\//.test(l)),
    "no line of the attach path builds claude flags"
  );
  check(body.indexOf("if (!attachPlan) {") !== -1, "an attach does not overwrite lastCwd");
}

// ---- startShell's refusal branches, behaviour ---------------------------------
{
  const shell = (overrides) => {
    const s = new F.Shell();
    const said = [];
    s.calls = [];
    s.term = { reset() { s.calls.push("reset"); }, writeln(t) { said.push(t); } };
    s.stopShell = () => s.calls.push("stop");
    s.getBackendKey = () => overrides.backend || "claude";
    s.said = said;
    return s;
  };
  const other = shell({ backend: "codex" });
  other.startShell(null, false, false, { sessionId: A, cwd: VAULT });
  equal(other.calls, [], "a non-claude tab: the old shell is not stopped and the screen is not cleared");
  check(other.said.some((l) => /another provider/.test(l)), "and the refusal is written");
  const bad = shell({});
  bad.startShell(null, false, false, { sessionId: A, cwd: WORK });
  equal(bad.calls, [], "an attach plan with a problem: nothing stopped, nothing cleared");
  check(bad.said.some((l) => /professional vault/.test(l)), "and the reason is written");
  const notUuid = shell({});
  notUuid.startShell(null, false, false, { sessionId: "not-a-uuid", cwd: VAULT });
  equal(notUuid.calls, [], "a bad session id: nothing stopped, nothing cleared");
  const ok = shell({});
  ok.startShell(null, false, false, { sessionId: A, cwd: VAULT });
  equal(ok.calls, ["stop", "reset"], "a passing attach stops the old shell, then clears the screen");
  const plain = shell({});
  plain.startShell();
  equal(plain.calls, ["stop"], "an ordinary start does not clear the screen");
}

Promise.all(pending)
  .then(() => {
    console.log((checks - failures) + "/" + checks + " session-cycling checks passed");
    if (failures) process.exit(1);
  })
  .catch((error) => {
    console.error("FAIL: an async check threw: " + ((error && error.stack) || error));
    process.exit(1);
  });
