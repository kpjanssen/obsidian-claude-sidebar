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
      "\nreturn { flowSessionNode, flowRootNode, flowAnchor, flowSummarise, flowFace," + " flowTooltip, flowValidateDocument, FLOW_SUPPORTED_KINDS };"
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

console.log((checks - failures) + "/" + checks + " face checks passed");
if (failures) process.exit(1);
