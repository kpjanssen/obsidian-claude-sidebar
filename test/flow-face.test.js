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
      "\nreturn { flowSessionNode, flowAnchor, flowSummarise, flowFace };"
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

console.log((checks - failures) + "/" + checks + " face checks passed");
if (failures) process.exit(1);
