// What a run graph is *called*, and where that name came from. `node
// test/flow-face.test.js`.
//
// The defect this file exists to catch is specific: the pane showed a truncated
// session id everywhere a title belonged, in the dropdown and on the session
// node, and nothing failed — an id is a perfectly good string. So the check is
// not "a name is present" but "the name did not come from the id", which is
// what `title_source` records and what is asserted below.
//
// Loaded out of `main.js` the same way `flow-layout.test.js` loads the layout,
// and for the same reason: a copy of these functions in a test would pass while
// the plugin drew something else.

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
  return new Function(
    source.slice(from, to) +
      "\nreturn { flowSessionNode, flowRootNode, flowAnchor, flowSummarise, flowFace, flowSubFace," +
      " flowTooltip, flowNodeClass, flowIsTrigger, flowTriggerState, flowValidateDocument," +
      " flowDetailFace," +
      " FLOW_SUPPORTED_KINDS, FLOW_TRIGGER_KINDS };"
  )();
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

const ENTRY = { file: "/x/a.graph.json", project: "vault", sessionId: "abcdef01-2345", mtimeMs: 0 };

function documentWith(session) {
  const nodes = [{ kind: "dispatch", "graph.node.id": "dispatch:toolu_1" }];
  if (session) nodes.unshift(session);
  return { schema_version: 2, kind: "run", nodes, counts: { "kind:dispatch": 1, nodes: nodes.length } };
}

// ---- the session node is found, and only the session node -----------------
const titled = { kind: "session", "graph.node.name": "Rename plugin to proj-flow", title_source: "ai_title" };
equal(F.flowSessionNode(documentWith(titled)), titled, "the session node is the one returned");
equal(F.flowSessionNode(documentWith(null)), null, "a document without a session node yields null");
equal(F.flowSessionNode(null), null, "a null document yields null rather than throwing");

// ---- a summary carries the title, and states where it came from -----------
const summary = F.flowSummarise(ENTRY, documentWith(titled));
equal(summary.title, "Rename plugin to proj-flow", "the summary states the session's title");
equal(summary.titleSource, "ai_title", "the summary states which record the title came from");
equal(summary.sessionId, "abcdef01-2345", "the id is still available to a caller that wants it");

// The important negative: no session node means no title, *not* a title that is
// secretly the id. A caller that falls back to the id must do so visibly.
const untitled = F.flowSummarise(ENTRY, documentWith(null));
equal(untitled.title, null, "a document with no session node has no title");
equal(untitled.titleSource, null, "and no title source either");

// A session that genuinely had no title record is still distinguishable, because
// the generator says so in title_source rather than passing the id off as a name.
const byId = F.flowSummarise(
  ENTRY,
  documentWith({ kind: "session", "graph.node.name": "abcdef01", title_source: "session_id" })
);
equal(byId.titleSource, "session_id", "an id-derived name is reported as id-derived");

// ---- the anchor mirrors _anchor() in canvas_core.py ------------------------
equal(F.flowAnchor("dispatch:toolu_01ABC"), "dispatch-toolu_01ABC", "a colon becomes a dash");
equal(F.flowAnchor("a:b|c#d"), "a-b-c-d", "every one of the three characters is replaced, not just the first");
equal(F.flowAnchor("session"), "session", "an id needing no replacement is unchanged");

// ---- flowFace is unchanged: a summary still wins over a name ---------------
equal(
  F.flowFace({ summary: "read the roster", "graph.node.name": "Task", "graph.node.id": "dispatch:1" }),
  "read the roster",
  "a dispatch summary still outranks its name"
);
equal(
  F.flowFace({ "graph.node.name": "Rename plugin", "graph.node.id": "session" }),
  "Rename plugin",
  "a session with no summary is drawn by its name"
);

// ---- a session carries what it was asked, and says so when it was not -----
// No transcript record type holds a written summary -- that was measured over
// the store, not assumed -- so the opening human instruction is the nearest
// recorded thing to one. Its absence has to read as absence.
const asked = {
  kind: "session",
  "graph.node.name": "Rename plugin to proj-flow",
  title_source: "ai_title",
  first_prompt: "rename the plugin everywhere and keep the deployed copy in step"
};
equal(
  F.flowSummarise(ENTRY, documentWith(asked)).firstPrompt,
  "rename the plugin everywhere and keep the deployed copy in step",
  "the summary carries the opening instruction"
);
equal(
  F.flowSummarise(ENTRY, documentWith(titled)).firstPrompt,
  null,
  "a session with no recorded opening instruction reports null, not an invented one"
);
check(
  F.flowTooltip(asked).indexOf("asked: rename the plugin") !== -1,
  "the hover text states what the session was asked"
);
check(
  F.flowTooltip(titled).indexOf("asked:") === -1,
  "a session with no opening instruction gets no asked line rather than an empty one"
);

// ---- a plan is a document this view accepts and names ---------------------
// The forward half. A plan has no session node at all: it is a definition of
// work that could run, so its name has to come from its root node, and the
// validator has to stop refusing it.
const PLAN_ENTRY = {
  file: "/x/nightly-sweep.plan.json",
  documentClass: "plan",
  project: ".claude/flow-plans",
  sessionId: "nightly-sweep",
  mtimeMs: 0
};
const planDocument = {
  schema_version: 2,
  kind: "plan",
  nodes: [
    { kind: "orchestrator", "graph.node.id": "orchestrator:root", "graph.node.name": "nightly-sweep" },
    {
      kind: "dispatch",
      "graph.node.id": "dispatch:1",
      "graph.node.parent_id": "orchestrator:root",
      "graph.node.name": "sweep"
    }
  ],
  counts: { "kind:dispatch": 1, nodes: 2 }
};
equal(F.flowSessionNode(planDocument), null, "a plan has no session node");
equal(
  F.flowRootNode(planDocument)["graph.node.id"],
  "orchestrator:root",
  "the root of a plan is the node with no recorded parent"
);
const planSummary = F.flowSummarise(PLAN_ENTRY, planDocument);
equal(planSummary.title, "nightly-sweep", "a plan is named by its root node");
equal(planSummary.titleSource, null, "a plan claims no title_source, because it has no session record");
equal(planSummary.firstPrompt, null, "a plan has been asked nothing yet");
equal(planSummary.documentClass, "plan", "the summary states which of the two kinds of document this is");

// ---- the validator accepts exactly the published kinds --------------------
check(F.flowValidateDocument(planDocument).ok, "a plan document is accepted");
check(
  F.flowValidateDocument({ schema_version: 2, kind: "trigger-inventory", nodes: [] }).ok,
  "a trigger inventory is accepted"
);
check(
  !F.flowValidateDocument({ schema_version: 2, kind: "something-else", nodes: [] }).ok,
  "an unpublished kind is still refused"
);
check(
  !F.flowValidateDocument({ schema_version: 9, kind: "plan", nodes: [] }).ok,
  "an unsupported schema version is still refused, kind notwithstanding"
);
equal(
  F.FLOW_SUPPORTED_KINDS.join(","),
  "run,plan,trigger-inventory",
  "the accepted set is the published one and nothing more"
);

// ---- and the real store, when it is there ---------------------------------
// The QA finding mechanised: every document the generator has actually written
// should carry a title from a title record, not from its own id.
(function theRealStore() {
  const store = process.env.FLOW_STORE;
  if (!store || !fs.existsSync(store)) return;
  let seen = 0;
  let fromId = 0;
  for (const project of fs.readdirSync(store, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = path.join(store, project.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".graph.json")) continue;
      const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const node = F.flowSessionNode(document);
      check(node !== null, "real document " + file + " has a session node");
      if (node && node.title_source === "session_id") fromId += 1;
      seen += 1;
    }
  }
  check(fromId === 0, fromId + " of " + seen + " real document(s) are still named by their id");
  console.log("checked " + seen + " document(s) from " + store);
})();

// Every plan actually on disk, when the directory is reachable. Points at the
// same failure from the other side: a plan the pane cannot name is a plan the
// selector shows as a bare filename.
(function theRealPlans() {
  const dir = process.env.FLOW_PLANS;
  if (!dir || !fs.existsSync(dir)) return;
  let seen = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".plan.json")) continue;
    const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    check(F.flowValidateDocument(document).ok, "real plan " + file + " is accepted by the validator");
    const root = F.flowRootNode(document);
    check(root !== null, "real plan " + file + " has a root node");
    check(
      !!(root && root["graph.node.name"]),
      "real plan " + file + " names itself rather than leaving the selector to the filename"
    );
    seen += 1;
  }
  console.log("checked " + seen + " plan(s) from " + dir);
})();

// Enablement and liveness are two fields, and every one of these checks exists
// because collapsing them into one would still pass a test that only looked at
// whether *something* was drawn.
(function aTriggerStatesBothFields() {
  const armed = { kind: "scheduled_task", enabled: true, liveness: "observed", scope: "in_scope" };
  equal(F.flowTriggerState(armed), "enabled \u00b7 observed", "an armed, seen trigger states both");
  equal(F.flowSubFace(armed), "enabled \u00b7 observed", "and that is its second line");

  const off = { kind: "scheduled_task", enabled: false, liveness: "observed" };
  equal(F.flowTriggerState(off), "disabled", "a disabled trigger says so");

  const blind = { kind: "git_hook", enabled: true, liveness: "unavailable" };
  equal(
    F.flowTriggerState(blind),
    "enabled \u00b7 liveness unavailable",
    "a trigger nothing can observe is not reported as never having fired"
  );

  const cold = { kind: "claude_hook", enabled: true, liveness: "never_observed" };
  equal(
    F.flowTriggerState(cold),
    "enabled \u00b7 never observed",
    "armed but never seen is its own state, not 'unavailable'"
  );

  const outside = { kind: "scheduled_task", enabled: true, scope: "out_of_scope", liveness: "observed" };
  equal(F.flowTriggerState(outside), "out of scope", "scope is read before either field");

  const silent = { kind: "scheduled_task", enabled: true };
  equal(
    F.flowTriggerState(silent),
    "enabled \u00b7 liveness unrecorded",
    "an absent liveness is stated as absent, never defaulted to observed"
  );
  equal(
    F.flowTriggerState({ kind: "git_hook" }),
    "enablement unrecorded",
    "an absent enablement is likewise stated rather than assumed true"
  );
})();

(function everyStateFitsTheClip() {
  // The node's second line is clipped at 30 characters, and the tail of a
  // trigger's state is its liveness -- the field this document exists for.
  const states = [
    { kind: "scheduled_task", enabled: true, liveness: "observed" },
    { kind: "scheduled_task", enabled: true, liveness: "never_observed" },
    { kind: "scheduled_task", enabled: true, liveness: "unavailable" },
    { kind: "scheduled_task", enabled: true },
    { kind: "scheduled_task", enabled: false },
    { kind: "scheduled_task", scope: "out_of_scope" }
  ];
  for (const state of states) {
    const text = F.flowSubFace(state);
    check(text.length <= 30, "the state '" + text + "' survives the 30-character clip");
  }
})();

(function aTriggerIsClassedByMechanismAndState() {
  equal(
    F.flowNodeClass({ kind: "claude_hook", enabled: true, liveness: "observed" }),
    "flow-node-trigger flow-node-claude-hook",
    "an armed, observed trigger carries no state modifier"
  );
  check(
    F.flowNodeClass({ kind: "git_hook", enabled: false }).indexOf("is-disabled") !== -1,
    "a disabled trigger is marked in the drawing, not only in its text"
  );
  check(
    F.flowNodeClass({ kind: "scheduled_task", enabled: true, scope: "out_of_scope" }).indexOf("is-out-of-scope") !== -1,
    "so is one out of scope"
  );
  equal(
    F.flowNodeClass({ kind: "dispatch", outcome: "ok" }),
    "flow-node-dispatch",
    "and a dispatch is untouched by any of it"
  );
  check(!F.flowIsTrigger({ kind: "dispatch" }), "a dispatch is not a trigger");
  check(!F.flowIsTrigger({ kind: "webhook" }), "an unseen kind is not assumed to be a trigger");
  equal(F.FLOW_TRIGGER_KINDS.length, 3, "three mechanisms, as a closed list");
})();

(function anInventoryIsNamedByItsMachine() {
  const document = {
    schema_version: 2,
    kind: "trigger-inventory",
    host: "A-MACHINE",
    counts: { nodes: 3 },
    nodes: [
      { "graph.node.id": "trigger:scheduled_task:0", "graph.node.name": "some task", kind: "scheduled_task" },
      { "graph.node.id": "trigger:scheduled_task:1", "graph.node.name": "another", kind: "scheduled_task" },
      { "graph.node.id": "trigger:git_hook:0", "graph.node.name": "a hook", kind: "git_hook" }
    ]
  };
  const summary = F.flowSummarise(
    { file: "x", project: "_flow", sessionId: "trigger-inventory", documentClass: "trigger-inventory" },
    document
  );
  equal(
    summary.title,
    "triggers on A-MACHINE",
    "an inventory is named by the machine, never by whichever trigger happens to be first"
  );
  equal(summary.documentClass, "trigger-inventory", "and it is classed as one");
  equal(summary.nodes, 3, "its measure is the mechanism count");
  equal(F.flowValidateDocument(document).ok, true, "the pane accepts it");

  const hostless = Object.assign({}, document);
  delete hostless.host;
  equal(
    F.flowSummarise({ file: "x", sessionId: "i", documentClass: "trigger-inventory" }, hostless).title,
    "triggers on an unrecorded host",
    "and an unrecorded host is stated, not filled in"
  );
})();

(function theHoverTextNamesTheMechanism() {
  const node = {
    kind: "scheduled_task",
    "graph.node.name": "OneDrive Reporting Task",
    enabled: true,
    liveness: "observed",
    triggers: "daily at 09:00",
    command: "C:/x/y.exe"
  };
  const tip = F.flowTooltip(node);
  check(tip.indexOf("mechanism: scheduled task") !== -1, "the hover text says what kind of trigger it is");
  check(tip.indexOf("fires: daily at 09:00") !== -1, "and when it fires");
  check(tip.indexOf("runs: C:/x/y.exe") !== -1, "and what it runs");
})();

// The inventory actually on disk, when the store is reachable.
(function theRealInventory() {
  const store = process.env.FLOW_STORE;
  if (!store || !fs.existsSync(store)) return;
  let seen = 0;
  for (const file of fs.readdirSync(store)) {
    if (!file.endsWith(".triggers.json")) continue;
    const document = JSON.parse(fs.readFileSync(path.join(store, file), "utf8"));
    equal(F.flowValidateDocument(document).ok, true, "real inventory " + file + " is accepted");
    for (const node of document.nodes || []) {
      check(F.flowIsTrigger(node), file + ": " + node["graph.node.id"] + " is a known mechanism");
      const state = F.flowTriggerState(node);
      check(state.length <= 30, file + ": '" + state + "' survives the clip");
      check(
        state !== "enablement unrecorded" && state !== "enabled \u00b7 liveness unrecorded",
        file + ": " + node["graph.node.id"] + " records both enablement and liveness"
      );
    }
    seen += 1;
  }
  console.log("checked " + seen + " trigger inventory/inventories from " + store);
})();

// ---- an agent-bearing node names its agent, not its kind -------------------
// The complaint this answers: the graph read as a wall of task descriptions
// with nothing saying what had run them. Measured over the live store on
// 2026-09-03, all 269 dispatch faces drew the word "dispatch" on line two and
// not one drew its agent type, because `model` is always present and the old
// `else if` only reached `agent_type` when it was absent.
{
  const ran = {
    kind: "dispatch",
    agent_type: "session-extractor",
    outcome: "completed",
    model: "sonnet",
    vault_touches: [{ path: "a" }, { path: "b" }],
    "graph.node.id": "dispatch:1",
  };
  equal(F.flowSubFace(ran), "session-extractor · completed", "line two names the agent");
  equal(F.flowDetailFace(ran), "sonnet · 2 files", "line three carries model and reach");
  equal(
    F.flowDetailFace(Object.assign({}, ran, { vault_touches: [{ path: "a" }] })),
    "sonnet · 1 file",
    "one touch is singular"
  );
  equal(
    F.flowDetailFace(Object.assign({}, ran, { vault_touches: [] })),
    "sonnet",
    "a dispatch that touched nothing says only what ran, not '0 files'"
  );

  // The regression guard on the other side: a node with no agent must keep the
  // face it had, model included, or this change quietly rewrites every
  // orchestrator and join in the store.
  const structural = { kind: "join", outcome: "completed", model: "opus", "graph.node.id": "join:1" };
  equal(F.flowSubFace(structural), "join · completed · opus", "a kind without an agent is unchanged");
  equal(F.flowDetailFace(structural), "", "and gains no third line");

  // A session is untouched by all of it.
  equal(
    F.flowDetailFace({ kind: "session", first_prompt: "mirror the sessions" }),
    "asked: mirror the sessions",
    "a session still opens with what it was asked"
  );
}

// ---- and both new lines survive their clips on real data -------------------
(() => {
  const store = process.env.FLOW_STORE;
  if (!store || !fs.existsSync(store)) return;
  let agents = 0;
  for (const project of fs.readdirSync(store)) {
    const dir = path.join(store, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".graph.json")) continue;
      const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const node of document.nodes || []) {
        if (!node.agent_type) continue;
        agents += 1;
        const sub = F.flowSubFace(node);
        const detail = F.flowDetailFace(node);
        check(sub.length <= 30, file + ": '" + sub + "' survives the 30-char clip");
        check(detail.length <= 32, file + ": '" + detail + "' survives the 32-char clip");
        check(sub.indexOf("dispatch") !== 0, file + ": " + node["graph.node.id"] + " leads with its agent");
      }
    }
  }
  console.log("checked " + agents + " agent-bearing node(s) for clip fit");
})();

console.log((checks - failures) + "/" + checks + " face checks passed");
if (failures) process.exit(1);
