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
  const stub = 'var import_obsidian = { Modal: function () {}, Notice: function () {} };\n';
  return new Function(
    stub +
      REGION.text +
      "\nreturn { flowActionForNode, flowPlanPreview, flowConfirmPhrase, flowChildArgv," +
      " flowLaunchSucceeded, flowLaunchFailureMessage, flowTargetStillValid," +
      " flowRepoLooksReal, flowResolveRepoPath, flowResolvePythonCmd, flowRunAction," +
      " FLOW_ACTION_LAUNCH, FLOW_ACTION_FORK, FLOW_REPO_ENV_VAR, flowRootNode, flowDocumentKind };"
  )();
}

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
    "C:\\pyenv\\shims\\python.bat",
    "a .bat shim (pyenv-win) is preferred over a plain exe"
  );
  equal(
    F.flowResolvePythonCmd("win32", false, ["C:\\Python312\\python.exe"]),
    "C:\\Python312\\python.exe",
    "the first where.exe result is used when there is no .bat shim"
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

Promise.all(pending)
  .then(() => {
    console.log((checks - failures) + "/" + checks + " node-action checks passed");
    if (failures) process.exit(1);
  })
  .catch((error) => {
    console.error("FAIL: an async check threw: " + ((error && error.stack) || error));
    process.exit(1);
  });
