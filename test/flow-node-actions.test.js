// The plugin half of launch-runs-from-graph. `node test/flow-node-actions.test.js`.
//
// Covers the pure decisions this capability makes before it ever touches a
// process: which action a node offers (task 1.1), the exact argv `flow` is
// spawned with (task 2.1 -- "no argv of its own" means no argv for the
// spawned Claude session, not for `flow` itself), how a `flow launch --json`
// exit is actually read (its own exit code is not the answer -- see
// flowLaunchSucceeded's own comment in main.js), the confirm-time re-check
// (task 1.4), and where `flow` and Python are found without ever writing a
// path into this plugin's own settings file.
//
// The two-step spawn (flowRunAction) is exercised with a fake spawner, per
// the harness this feature shipped under -- assertions below pin the exact
// calls it makes, in order, the way flow/launch.py's own Python tests pin
// `launch()`'s calls to its injected spawner.
//
// Loaded out of main.js rather than reimplemented, for the reason every
// sibling file in this directory gives: a copy of these functions in a test
// would pass while the plugin did something else.

const fs = require("fs");
const path = require("path");

const BEGIN = "var FLOW_RESERVED_DIRNAME";
const END = "// ===== proj-flow run-graph view — END =====";

function loadRegion() {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const from = source.indexOf(BEGIN);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error("the run-graph region is not in main.js; markers have moved");
  }
  return {
    text: source.slice(from, to),
    whole: source
  };
}

const REGION = loadRegion();

function loadPure() {
  // Nothing called below touches `fs`, `path`, `document`, `app` or
  // `import_child_process` -- flowRunAction's default spawner and
  // flowResolveRepoPath's default path are both bypassed by the arguments
  // every call passes explicitly. `import_obsidian` is the one exception:
  // `FlowLaunchConfirmModal extends import_obsidian.Modal` resolves its
  // `extends` clause the moment the class *declaration* runs, not when a
  // dialog is opened, so the region needs a stand-in even though no test
  // below ever opens one.
  // The Modal stand-in records the dialog that was opened (globalThis.__modal)
  // and Notice records what the operator was told (globalThis.__notices), so
  // the pane's real methods can be driven below.
  const stub =
    "var import_obsidian = { Modal: (function () { function M() {} M.prototype.open = function () { globalThis.__modal = this; };" +
    " M.prototype.close = function () {}; return M; })(), Notice: function (m) { globalThis.__notices.push(String(m)); } };\n";
  return new Function(
    "fs",
    "path",
    "import_child_process",
    stub +
      REGION.text +
      "\nreturn { flowActionForNode, flowPlanPreview, flowConfirmPhrase, flowChildArgv," +
      " flowLaunchSucceeded, flowLaunchFailureMessage, flowTargetStillValid," +
      " flowRepoLooksReal, flowResolveRepoPath, flowResolvePythonCmd, flowRunAction," +
      " FLOW_ACTION_LAUNCH, FLOW_ACTION_FORK, FLOW_REPO_ENV_VAR, flowRootNode, flowDocumentKind," +
      " FlowGraphPane, flowSpawnChild, flowDetectPythonCmd, flowResetPythonCache, flowLaunchesInFlight };"
  )(fs, path, require("child_process"));
}
globalThis.__notices = [];

const F = loadPure();

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
    message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")"
  );
}

// ---------------------------------------------------------------- fixtures

const PLAN_ROOT = { "graph.node.id": "orchestrator:p1", kind: "orchestrator", model: "claude-opus-4-6" };
const PLAN_DOC = { schema_version: 2, kind: "plan", nodes: [PLAN_ROOT] };
const PLAN_DOC_NO_MODEL = {
  schema_version: 2,
  kind: "plan",
  nodes: [{ "graph.node.id": "orchestrator:p2", kind: "orchestrator" }]
};

const SESSION_NODE = { "graph.node.id": "session:abc", kind: "session" };
const DISPATCH_NODE = { "graph.node.id": "dispatch:1", kind: "dispatch", "graph.node.parent_id": "session:abc" };
const RUN_DOC = { schema_version: 2, kind: "run", session_id: "abc-123", nodes: [SESSION_NODE, DISPATCH_NODE] };

// ---------------------------------------------------------- flowActionForNode

(function actionsComeFromKindAndDocument() {
  equal(F.flowActionForNode(PLAN_DOC, PLAN_ROOT), F.FLOW_ACTION_LAUNCH, "a plan's root offers Launch");
  equal(F.flowActionForNode(RUN_DOC, SESSION_NODE), F.FLOW_ACTION_FORK, "a run's session node offers Fork");
  equal(F.flowActionForNode(RUN_DOC, DISPATCH_NODE), null, "a dispatch inside a run offers nothing");
  equal(F.flowActionForNode(PLAN_DOC, DISPATCH_NODE), null, "a non-root node inside a plan offers nothing");
  equal(F.flowActionForNode(null, PLAN_ROOT), null, "no document, no action");
  equal(F.flowActionForNode(PLAN_DOC, null), null, "no node, no action");
})();

// ------------------------------------------------------------ flowPlanPreview

(function previewReadsTheRootsModelAndNothingElse() {
  equal(F.flowPlanPreview(PLAN_DOC), { model: "claude-opus-4-6" }, "the root's own model is shown");
  equal(F.flowPlanPreview(PLAN_DOC_NO_MODEL), { model: null }, "absent stays absent -- never a guessed default");
})();

// ---------------------------------------------------------- flowConfirmPhrase

(function phraseMatchesFlowModesLaunchPyExactly() {
  equal(F.flowConfirmPhrase("nightly-triage"), "launch nightly-triage", 'the phrase is "launch %s" % name, verbatim');
})();

// -------------------------------------------------------------- flowChildArgv

(function compileArgvCarriesOnlyIdsAndNames() {
  const argv = F.flowChildArgv("compile", {
    planName: "nightly-triage",
    vaultPath: "C:\\Users\\koen\\Vault",
    originNodeId: "orchestrator:p1",
    resumeSessionId: "abc-123"
  });
  equal(
    argv,
    [
      "-m", "flow", "compile",
      "--plan", "nightly-triage",
      "--vault", "C:\\Users\\koen\\Vault",
      "--json",
      "--origin-node", "orchestrator:p1",
      "--resume", "abc-123"
    ],
    "compile carries --plan, --vault, --json, --origin-node and --resume"
  );
})();

(function compileArgvOmitsForkFlagsWhenThereIsNoFork() {
  const argv = F.flowChildArgv("compile", { planName: "p", vaultPath: "V" });
  check(argv.indexOf("--resume") === -1, "no --resume on a fresh launch");
  check(argv.indexOf("--origin-node") === -1, "no --origin-node when none was given");
})();

(function launchArgvNeverCarriesResumeOrOriginNode() {
  // flow/modes/launch.py reads only --plan, --vault, --confirm and --json:
  // the resume target and the origin node were already written into the
  // specification at compile time. Passing them again to launch would be
  // dead weight at best and a second place for the two to disagree at worst.
  const argv = F.flowChildArgv("launch", {
    planName: "nightly-triage",
    vaultPath: "V",
    originNodeId: "orchestrator:p1",
    resumeSessionId: "abc-123",
    confirmPhrase: "launch nightly-triage"
  });
  equal(
    argv,
    ["-m", "flow", "launch", "--plan", "nightly-triage", "--vault", "V", "--json", "--confirm", "launch nightly-triage"],
    "launch carries --plan, --vault, --json and --confirm only"
  );
})();

(function dryRunLaunchArgvOmitsConfirm() {
  const argv = F.flowChildArgv("launch", { planName: "p", vaultPath: "V" });
  check(argv.indexOf("--confirm") === -1, "no --confirm when none was supplied");
})();

(function neitherModeEverNamesClaude() {
  const compileArgv = F.flowChildArgv("compile", { planName: "p", vaultPath: "V" });
  const launchArgv = F.flowChildArgv("launch", { planName: "p", vaultPath: "V", confirmPhrase: "launch p" });
  check(compileArgv.indexOf("claude") === -1, "compile's argv never names claude");
  check(launchArgv.indexOf("claude") === -1, "launch's argv never names claude");
  equal(compileArgv.slice(0, 2), ["-m", "flow"], "every child process this pane spawns is python -m flow");
  equal(launchArgv.slice(0, 2), ["-m", "flow"], "every child process this pane spawns is python -m flow");
})();

// --------------------------------------------------------- flowLaunchSucceeded

(function exitZeroIsNotSuccessOnItsOwn() {
  check(F.flowLaunchSucceeded([{ outcome: "completed" }]), "a completed outcome is success");
  check(!F.flowLaunchSucceeded([{ outcome: "never_started", error: "ENOENT" }]), "never_started is not success");
  check(!F.flowLaunchSucceeded([{ outcome: "authentication_failed" }]), "an auth failure is not success");
  check(!F.flowLaunchSucceeded([]), "an empty result list is not success");
  check(!F.flowLaunchSucceeded(null), "a non-array is not success");
  check(
    !F.flowLaunchSucceeded([{ outcome: "completed" }, { outcome: "failed" }]),
    "one bad root among several roots is not success"
  );
})();

(function failureMessageNamesTheActualOutcome() {
  const msg = F.flowLaunchFailureMessage([{ outcome: "never_started", error: "claude: command not found" }]);
  check(msg.indexOf("never_started") !== -1, "the message names the outcome");
  check(msg.indexOf("claude: command not found") !== -1, "the message carries the recorded error");
  const withLog = F.flowLaunchFailureMessage([{ outcome: "failed", returncode: 1, log: "/x/y.log" }]);
  check(withLog.indexOf("exit 1") !== -1 && withLog.indexOf("/x/y.log") !== -1, "returncode and log are both named");
  equal(F.flowLaunchFailureMessage([]), "flow launch printed no result.", "an empty list states that plainly");
})();

// ------------------------------------------------------------ flowTargetStillValid

(function reCheckedAtConfirmTime() {
  const snapshot = { nodePresent: true, planFile: "/plans/x.plan.json", planMtimeMs: 100 };
  check(
    F.flowTargetStillValid(snapshot, { nodePresent: true, planFile: "/plans/x.plan.json", planMtimeMs: 100 }),
    "an unchanged target is still valid"
  );
  check(
    !F.flowTargetStillValid(snapshot, { nodePresent: true, planFile: "/plans/x.plan.json", planMtimeMs: 999 }),
    "a changed modified time refuses"
  );
  check(
    !F.flowTargetStillValid(snapshot, { nodePresent: false, planFile: "/plans/x.plan.json", planMtimeMs: 100 }),
    "an origin node no longer in the loaded document refuses"
  );
  check(
    !F.flowTargetStillValid(snapshot, { nodePresent: true, planFile: "/plans/y.plan.json", planMtimeMs: 100 }),
    "a different plan file refuses"
  );
  check(!F.flowTargetStillValid(null, { nodePresent: true }), "no snapshot refuses");
  check(!F.flowTargetStillValid(snapshot, null), "no current reading refuses");
})();

// -------------------------------------------------------- flowResolveRepoPath

(function envVarOverridesAndAnAbsentRepoIsReportedNotGuessed() {
  const alwaysTrue = () => true;
  const alwaysFalse = () => false;
  equal(
    F.flowResolveRepoPath({ FLOW_REPO_PATH: "D:\\code\\proj-flow" }, alwaysTrue),
    "D:\\code\\proj-flow",
    "the environment variable overrides, exactly like PROJ_CLI_VAULT"
  );
  equal(F.flowResolveRepoPath({ FLOW_REPO_PATH: "D:\\nope" }, alwaysFalse), null, "a repo that fails the marker check is absent, not guessed at");
  equal(F.flowResolveRepoPath({}, alwaysFalse), null, "no env and no real default is simply absent");
  check(F.flowRepoLooksReal("", alwaysTrue) === false, "an empty path is never real");
})();

(function repoMarkerIsCheckedNotJustTheDirectory() {
  let seen = null;
  F.flowRepoLooksReal("C:\\Repos\\proj-flow", (p) => {
    seen = p;
    return true;
  });
  check(seen === "C:\\Repos\\proj-flow\\flow\\__main__.py", "the check is against flow's own entry point");
})();

// ------------------------------------------------------- flowResolvePythonCmd

(function pythonResolutionMatchesStartShellsOwnOrder() {
  equal(F.flowResolvePythonCmd("darwin", false, []), "python3", "non-Windows always uses python3");
  equal(F.flowResolvePythonCmd("win32", true, []), "py", "the py launcher wins when it is present");
  equal(
    F.flowResolvePythonCmd("win32", false, ["C:\\pyenv\\shims\\python.bat", "C:\\Python312\\python.exe"]),
    "C:\\Python312\\python.exe",
    "a .bat shim is never chosen (Node cannot spawn it without a shell); the real exe is"
  );
  equal(
    F.flowResolvePythonCmd("win32", false, ["C:\\a\\python.bat", "C:\\b\\python.CMD"]),
    "python",
    "with only .bat/.cmd shims the answer is a bare python"
  );
  equal(
    F.flowResolvePythonCmd("win32", false, ["C:\\Python312\\python.exe"]),
    "C:\\Python312\\python.exe",
    "the first .exe where.exe reports is used"
  );
  equal(F.flowResolvePythonCmd("win32", false, []), "python", "the last resort is a bare python and hoping");
})();

// ------------------------------------------------------------- flowRunAction

function fakeSpawn(script) {
  const calls = [];
  const spawn = (cmd, argv, options) => {
    calls.push({ cmd, argv, options });
    const reply = script[calls.length - 1];
    if (!reply) throw new Error("fake spawner asked for a call it was not scripted for: " + JSON.stringify(argv));
    return Promise.resolve(reply);
  };
  return { spawn, calls };
}

const BASE_OPTS = {
  planName: "nightly-triage",
  vaultPath: "C:\\Vault",
  flowRepoPath: "C:\\Repos\\proj-flow",
  pythonCmd: "py",
  originNodeId: "orchestrator:p1",
  resumeSessionId: null
};

const pending = [];

pending.push((function successSpawnsExactlyTwoCallsInOrder() {
  const fake = fakeSpawn([
    { code: 0, stdout: "compiled 1 root(s) -> spec.json\n", stderr: "" },
    { code: 0, stdout: JSON.stringify([{ outcome: "completed", session_id: "new-1" }]), stderr: "" }
  ]);
  return F.flowRunAction(BASE_OPTS, { spawn: fake.spawn }).then((result) => {
    check(result.ok === true, "a completed outcome reports ok");
    equal(fake.calls.length, 2, "exactly two child processes were spawned");
    equal(fake.calls[0].cmd, "py", "the first call uses the resolved python command");
    equal(fake.calls[0].argv[2], "compile", "the first call is compile");
    equal(fake.calls[0].options.cwd, "C:\\Repos\\proj-flow", "compile runs with cwd set to the flow repository");
    equal(fake.calls[1].argv[2], "launch", "the second call is launch");
    check(!!fake.calls[1].options.detached, "the launch call is spawned detached, so it outlives this pane");
    check(!fake.calls[0].options.detached, "the compile call is not detached -- it is short-lived and awaited");
  });
})());

pending.push((function aCompileRefusalNeverReachesLaunch() {
  const fake = fakeSpawn([{ code: 1, stdout: "", stderr: "refused: the plan does not validate\n" }]);
  return F.flowRunAction(BASE_OPTS, { spawn: fake.spawn }).then((result) => {
    check(result.ok === false, "a compile refusal is not ok");
    equal(result.stage, "compile", "the refusal is attributed to the compile stage");
    check(result.message.indexOf("refused") !== -1, "the refusal text is carried through");
    equal(fake.calls.length, 1, "launch is never invoked after compile refuses");
  });
})());

pending.push((function aLaunchThatNeverStartedIsReportedDespiteExitZero() {
  const fake = fakeSpawn([
    { code: 0, stdout: "compiled 1 root(s)\n", stderr: "" },
    {
      code: 0,
      stdout: JSON.stringify([{ outcome: "never_started", error: "[WinError 2] claude not found", session_id: "s1" }]),
      stderr: ""
    }
  ]);
  return F.flowRunAction(BASE_OPTS, { spawn: fake.spawn }).then((result) => {
    check(result.ok === false, "never_started is not ok even though flow launch exited 0");
    equal(result.stage, "launch", "attributed to the launch stage");
    check(result.message.indexOf("never_started") !== -1, "the outcome is named");
    check(result.message.indexOf("claude not found") !== -1, "the recorded error is named");
  });
})());

pending.push((function unparseableLaunchOutputIsReportedRatherThanThrown() {
  const fake = fakeSpawn([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "not json", stderr: "" }
  ]);
  return F.flowRunAction(BASE_OPTS, { spawn: fake.spawn }).then((result) => {
    check(result.ok === false, "unparseable output is not ok");
    check(result.message.toLowerCase().indexOf("json") !== -1, "the message says parsing failed");
  });
})());

// -------------------------------------------------------------------- wiring

(function theBoundaryGuardIsActuallyCalledFromThisRegion() {
  // flowWorkVaultProblem is defined in this region and, before this feature,
  // was only ever called from startShell -- outside it. This asserts it is
  // now called from inside the region too: once to decide whether to draw
  // the button at all, and once more immediately before anything is spawned.
  const occurrences = (REGION.text.match(/flowWorkVaultProblem\(/g) || []).length;
  // One is the function's own declaration line ("function
  // flowWorkVaultProblem(dir) {"); the rest are call sites.
  check(occurrences >= 3, "the boundary guard is called at least twice from within this region (found " + occurrences + " total occurrences)");
})();

(function nothingInThisRegionDeletesOrOverwritesAStoredRecord() {
  // Task 1.5. A source scan rather than a behavioural test, on the same terms
  // flow-launch.test.js already checks wiring by reading main.js as text: the
  // property being asserted is the absence of a call, which a unit test of
  // the functions that do exist cannot show.
  const destructive = /fs\.(unlink|rm|rmdir|rmSync|unlinkSync|writeFile|writeFileSync|appendFile|appendFileSync)\(/g;
  const found = REGION.text.match(destructive) || [];
  equal(found, [], "no destructive or write fs call appears anywhere in the run-graph region");
})();

(function onlyOneRealSpawnCallSiteExists() {
  // flowSpawnChild is the only place this feature calls
  // import_child_process.spawn; everywhere else goes through it (or through
  // flowRunAction's injected dependency, which is not this). A second ad hoc
  // spawn call site would be exactly the place a literal "claude" could be
  // smuggled in without flowChildArgv's own tests catching it.
  const spawnCalls = (REGION.text.match(/import_child_process\.spawn\(/g) || []).length;
  equal(spawnCalls, 1, "import_child_process.spawn is called from exactly one place in this region");
  const execSyncLines = REGION.text.split("\n").filter((line) => line.indexOf("import_child_process.execSync(") !== -1);
  for (const line of execSyncLines) {
    check(line.toLowerCase().indexOf("claude") === -1, "no execSync call in this region names claude: " + line.trim());
  }
})();

(function theLaunchButtonIsNeverDisabledOnlyAbsent() {
  // Task 1.6, checked the way the rest of this pane already states it should
  // be checked: not present in the markup at all, never present-and-greyed.
  check(REGION.text.indexOf(".disabled = true") === -1, "no control in this region is ever disabled rather than omitted");
  check(REGION.text.indexOf("disabled: true") === -1, "no control in this region is ever disabled rather than omitted");
})();

// ===========================================================================
// P2b defect regressions: fork preview, fork drift, in-flight guard, failure
// visibility, .bat shim, timeouts, persistent failure node, spawn robustness.
// One sequential chain so the shared Notice list and in-flight set are never
// interleaved with another check.
// ===========================================================================

const os = require("os");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flow-p2b-"));
}

function writePlan(dir, name, model) {
  const file = path.join(dir, name + ".json");
  fs.writeFileSync(
    file,
    JSON.stringify({ nodes: [{ "graph.node.id": "root:" + name, kind: "orchestrator", model }], edges: [] })
  );
  return file;
}

function makePane(plans) {
  const pane = Object.create(F.FlowGraphPane.prototype);
  pane.app = {};
  pane.destroyed = false;
  pane.pendingFailures = new Map();
  pane.document = { session_id: "sess-1", nodes: [{ "graph.node.id": "o1" }], edges: [] };
  pane.byId = new Map([["o1", pane.document.nodes[0]]]);
  pane.summaries = plans.map((p) => ({ documentClass: "plan", sessionId: p.name, file: p.file }));
  pane.renderGraph = () => {};
  pane.renderDetail = () => {};
  return pane;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const OK_LAUNCH = { code: 0, stdout: JSON.stringify([{ outcome: "completed", session_id: "n1" }]), stderr: "" };

pending.push(
  (async function p2bRegressions() {
    const dir = tmpdir();
    const fileA = writePlan(dir, "plan-a", "opus");
    const fileB = writePlan(dir, "plan-b", "sonnet");
    const plans = [
      { name: "plan-a", file: fileA },
      { name: "plan-b", file: fileB }
    ];
    const VAULT = "C:\\Vault";

    // ---- defect 1: the fork dialog previews the model of the chosen plan.
    {
      const pane = makePane(plans);
      globalThis.__modal = null;
      pane.openLaunchDialog(F.FLOW_ACTION_FORK, pane.document.nodes[0], "C:\\Repos\\proj-flow", VAULT);
      const opts = globalThis.__modal.opts;
      equal(opts.describePlan("plan-a").model, "opus", "fork preview reads the model of plan-a by its name");
      equal(opts.describePlan("plan-b").model, "sonnet", "fork preview follows the selection to plan-b");
      equal(opts.describePlan("no-such-plan").model, null, "an unknown plan name previews as not named");

      // ---- defect 2: the snapshot is taken when the dialog opens, so a plan
      // edited while the dialog is open is refused at confirm.
      const later = new Date(Date.now() + 60000);
      fs.utimesSync(fileA, later, later);
      globalThis.__notices = [];
      const fake = fakeSpawn([]);
      // onConfirm has no deps parameter; drive confirmLaunch the way it does.
      const before = fake.calls.length;
      pane.confirmLaunch = ((orig) => (params) => orig.call(pane, Object.assign({}, params, { deps: { spawn: fake.spawn, pythonCmd: "py" } })))(
        pane.confirmLaunch
      );
      await opts.onConfirm("plan-a");
      check(
        globalThis.__notices.some((n) => n.indexOf("changed") !== -1),
        "a fork plan edited after the dialog opened is refused with a notice"
      );
      equal(fake.calls.length, before, "and nothing is spawned for it");
      // An untouched plan is still allowed (plan-b): the drift check is not a blanket refusal.
      const fake2 = fakeSpawn([{ code: 0, stdout: "ok", stderr: "" }, OK_LAUNCH]);
      pane.confirmLaunch = Object.getPrototypeOf(pane).confirmLaunch;
      await pane.confirmLaunch({
        action: F.FLOW_ACTION_FORK,
        repoPath: "C:\\Repos\\proj-flow",
        vaultPath: VAULT,
        planName: "plan-b",
        originNodeId: "o1",
        resumeSessionId: "sess-1",
        snapshot: { planFile: fileB, planMtimeMs: fs.statSync(fileB).mtimeMs },
        deps: { spawn: fake2.spawn, pythonCmd: "py" }
      });
      equal(fake2.calls.length, 2, "an unchanged plan compiles and launches");
    }

    const snapOf = (file) => ({ planFile: file, planMtimeMs: fs.statSync(file).mtimeMs });
    const baseParams = (extra) =>
      Object.assign(
        {
          action: F.FLOW_ACTION_LAUNCH,
          repoPath: "C:\\Repos\\proj-flow",
          vaultPath: VAULT,
          planName: "plan-b",
          originNodeId: "o1",
          resumeSessionId: null,
          snapshot: snapOf(fileB)
        },
        extra
      );

    // ---- defect 3: a second confirm while the first runs starts nothing.
    {
      const pane = makePane(plans);
      globalThis.__notices = [];
      const gate = deferred();
      const calls = [];
      const spawn = (cmd, argv, options) => {
        calls.push(argv[2]);
        return argv[2] === "compile" ? gate.promise : Promise.resolve(OK_LAUNCH);
      };
      const first = pane.confirmLaunch(baseParams({ deps: { spawn, pythonCmd: "py" } }));
      const second = pane.confirmLaunch(baseParams({ deps: { spawn, pythonCmd: "py" } }));
      await second;
      check(
        globalThis.__notices.some((n) => n.indexOf("already running") !== -1),
        "the second confirm is refused with a notice"
      );
      gate.resolve({ code: 0, stdout: "", stderr: "" });
      await first;
      equal(calls, ["compile", "launch"], "two confirms produce exactly one compile and one launch");
      equal(F.flowLaunchesInFlight.size, 0, "the in-flight key is cleared when the run ends");
      await pane.confirmLaunch(baseParams({ deps: { spawn, pythonCmd: "py" } }));
      equal(calls.length, 4, "after it ends the same launch may be started again");

      // The dialog itself refuses while a launch from the node is running.
      const gate2 = deferred();
      const running = pane.confirmLaunch(
        baseParams({ deps: { spawn: () => gate2.promise, pythonCmd: "py" } })
      );
      globalThis.__modal = null;
      globalThis.__notices = [];
      pane.openLaunchDialog(F.FLOW_ACTION_LAUNCH, pane.document.nodes[0], "C:\\Repos\\proj-flow", VAULT);
      check(globalThis.__modal === null, "no dialog opens while a launch from that node runs");
      gate2.resolve({ code: 1, stdout: "", stderr: "x" });
      await running;
      // A rejecting spawner also clears the key.
      await pane.confirmLaunch(baseParams({ deps: { spawn: () => Promise.reject(new Error("boom")), pythonCmd: "py" } }));
      equal(F.flowLaunchesInFlight.size, 0, "a spawner that rejects still clears the in-flight key");
    }

    // ---- defect 4: a failure is announced even if the pane was destroyed.
    {
      const pane = makePane(plans);
      globalThis.__notices = [];
      const gate = deferred();
      const run = pane.confirmLaunch(baseParams({ deps: { spawn: () => gate.promise, pythonCmd: "py" } }));
      pane.destroyed = true;
      gate.resolve({ code: 1, stdout: "", stderr: "refused: no model" });
      await run;
      check(
        globalThis.__notices.some((n) => n.indexOf("refused") !== -1 && n.indexOf("no model") !== -1),
        "a compile refusal after the pane is destroyed still shows a notice"
      );
      globalThis.__notices = [];
      pane.destroyed = false;
      const gate2 = deferred();
      const run2 = pane.confirmLaunch(baseParams({ deps: { spawn: () => gate2.promise, pythonCmd: "py" } }));
      pane.destroyed = true;
      gate2.resolve(Promise.reject(new Error("ENOENT python")));
      await run2;
      check(
        globalThis.__notices.some((n) => n.indexOf("ENOENT python") !== -1),
        "an unexpected failure after the pane is destroyed still shows a notice"
      );
    }

    // ---- defect 7: the failure node survives a document replacement.
    {
      const pane = makePane(plans);
      pane.injectFailureNode("o1", F.FLOW_ACTION_LAUNCH, "the full reason, not clipped ".repeat(20));
      check(pane.document.nodes.some((n) => n.kind === "launch_failed"), "the failure node is added");
      // The watcher replaces the document wholesale.
      pane.document = { session_id: "sess-1", nodes: [{ "graph.node.id": "o1" }], edges: [] };
      pane._applyPendingFailures();
      const node = pane.document.nodes.find((n) => n.kind === "launch_failed");
      check(!!node, "the failure node is re-applied after the document is replaced");
      check(node && node.error.length > 180, "and carries the full message, not the clipped notice text");
      pane._applyPendingFailures();
      equal(pane.document.nodes.filter((n) => n.kind === "launch_failed").length, 1, "re-applying is idempotent");
      pane.dismissFailure("o1");
      equal(pane.document.nodes.filter((n) => n.kind === "launch_failed").length, 0, "dismiss removes it");
      pane.document = { session_id: "sess-1", nodes: [{ "graph.node.id": "o1" }], edges: [] };
      pane._applyPendingFailures();
      equal(pane.document.nodes.length, 1, "and it does not come back once dismissed");
    }

    // ---- defect 8: confirmLaunch refusals.
    {
      const pane = makePane(plans);
      const fake = fakeSpawn([]);
      globalThis.__notices = [];
      await pane.confirmLaunch(
        baseParams({
          vaultPath: "C:\\Users\\x\\OneDrive - Some Employer B.V\\Vault",
          deps: { spawn: fake.spawn, pythonCmd: "py" }
        })
      );
      check(globalThis.__notices.some((n) => n.indexOf("professional vault") !== -1), "the professional vault is refused");
      equal(fake.calls.length, 0, "and nothing is spawned for it");

      globalThis.__notices = [];
      await pane.confirmLaunch(baseParams({ planName: "vanished", deps: { spawn: fake.spawn, pythonCmd: "py" } }));
      check(globalThis.__notices.some((n) => n.indexOf("no longer available") !== -1), "a vanished plan is refused");
      equal(fake.calls.length, 0, "and nothing is spawned for it");

      const stale = baseParams({ snapshot: { planFile: fileB, planMtimeMs: 1 }, deps: { spawn: fake.spawn, pythonCmd: "py" } });
      globalThis.__notices = [];
      await pane.confirmLaunch(stale);
      check(globalThis.__notices.some((n) => n.indexOf("changed") !== -1), "a stale snapshot is refused");
      equal(fake.calls.length, 0, "and nothing is spawned for it");

      pane.byId = new Map();
      globalThis.__notices = [];
      await pane.confirmLaunch(baseParams({ deps: { spawn: fake.spawn, pythonCmd: "py" } }));
      equal(fake.calls.length, 0, "an origin node that left the document refuses too");
    }

    // ---- argv equality with spaces in the vault and repo paths.
    {
      const fake = fakeSpawn([{ code: 0, stdout: "", stderr: "" }, OK_LAUNCH]);
      await F.flowRunAction(
        Object.assign({}, BASE_OPTS, {
          vaultPath: "C:\\My Vault\\sub dir",
          flowRepoPath: "C:\\Repos\\proj flow",
          planName: "plan with space"
        }),
        { spawn: fake.spawn }
      );
      equal(
        fake.calls[0].argv,
        ["-m", "flow", "compile", "--plan", "plan with space", "--vault", "C:\\My Vault\\sub dir", "--json", "--origin-node", "orchestrator:p1"],
        "compile argv keeps a space-containing path as one element"
      );
      equal(fake.calls[0].options.cwd, "C:\\Repos\\proj flow", "cwd keeps its space");
      check(fake.calls[0].options.timeoutMs > 0, "compile is spawned with a bounded timeout");
      check(fake.calls[1].options.timeoutMs === undefined, "launch has no timeout: it lasts as long as the session");
    }

    // ---- defect 6 and 8: flowSpawnChild against real node children.
    {
      const node = process.execPath;
      const ok = await F.flowSpawnChild(node, ["-e", "console.log('hi')"], { cwd: dir });
      equal([ok.code, ok.stdout.trim()], [0, "hi"], "a clean child reports code 0 and its stdout");
      const bad = await F.flowSpawnChild(node, ["-e", "console.error('nope');process.exit(1)"], { cwd: dir });
      equal([bad.code, bad.stderr.trim()], [1, "nope"], "a non-zero exit is reported with its stderr");
      const missing = await F.flowSpawnChild(path.join(dir, "no-such-binary"), [], { cwd: dir });
      check(missing.code === null && /ENOENT|no-such-binary/.test(missing.stderr), "a missing binary resolves with a failure, never throws");
      const spaced = await F.flowSpawnChild(
        node,
        ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "a b", "c\"d"],
        { cwd: dir }
      );
      equal(JSON.parse(spaced.stdout), ["a b", "c\"d"], "argv with spaces and quotes reaches the child intact");
      const t0 = Date.now();
      const slow = await F.flowSpawnChild(node, ["-e", "setTimeout(()=>{},30000)"], { cwd: dir, timeoutMs: 300 });
      check(slow.code === null && slow.stderr.indexOf("timed out") !== -1, "a hung child is killed and reported as timed out");
      check(Date.now() - t0 < 10000, "and the timeout fires promptly");
      const keepAlive = setInterval(() => {}, 100); // an unref()ed child does not hold the event loop open
      const det = await F.flowSpawnChild(node, ["-e", "console.log('d')"], { cwd: dir, detached: true });
      clearInterval(keepAlive);
      equal([det.code, det.stdout.trim()], [0, "d"], "a detached child still reports its result");
    }

    // ---- defect 6: the python probes are async and cached.
    {
      F.flowResetPythonCache();
      let execs = 0;
      const execFile = (file, args, opts, cb) => {
        execs += 1;
        setImmediate(() => {
          if (file === "py") return cb(new Error("no py"));
          cb(null, "C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe\r\nC:\\pyenv\\python.bat\r\nC:\\Python312\\python.exe\r\n");
        });
      };
      const cmd = await F.flowDetectPythonCmd({ execFile, platform: "win32" });
      equal(cmd, "C:\\Python312\\python.exe", "probe skips WindowsApps and .bat shims and picks the real exe");
      const again = await F.flowDetectPythonCmd({ execFile, platform: "win32" });
      equal([again, execs], ["C:\\Python312\\python.exe", 2], "the answer is cached: no further probes");
      F.flowResetPythonCache();
      const withPy = await F.flowDetectPythonCmd({ execFile: (f, a, o, cb) => setImmediate(() => cb(null, "Python 3")), platform: "win32" });
      equal(withPy, "py", "the py launcher wins when its probe succeeds");
      F.flowResetPythonCache();
      const none = await F.flowDetectPythonCmd({ execFile: (f, a, o, cb) => setImmediate(() => cb(new Error("x"))), platform: "win32" });
      equal(none, "python", "with nothing found the answer is a bare python");
      F.flowResetPythonCache();
      check(REGION.text.indexOf('execSync("py') === -1 && REGION.text.indexOf('execSync("where') === -1,
        "no synchronous python probe remains in the run-graph region");
    }

    fs.rmSync(dir, { recursive: true, force: true });
  })()
);

Promise.all(pending)
  .then(() => {
    console.log((checks - failures) + "/" + checks + " node-action checks passed");
    if (failures) process.exit(1);
  })
  .catch((error) => {
    console.error("FAIL: an async check threw: " + ((error && error.stack) || error));
    process.exit(1);
  });
