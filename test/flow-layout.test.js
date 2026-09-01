// Layout assertions for the run-graph pane. `node test/flow-layout.test.js`.
//
// The pane's drawing rules live in one pure function, `flowLayout`, and this
// file is the only place they are checked mechanically. It loads that function
// out of `main.js` rather than duplicating it: a copy of the layout in a test
// would pass while the plugin drew something else.
//
// What is checked here is what a machine can settle — that no two node boxes
// land on the same pixels, that a 21-member fan-out (the widest measured in the
// live store) wraps rather than drawing one 21-row strip, and that the same
// document lays out identically twice. Whether the result is *legible* is a
// person looking at the screen, and that is task 3.5's acceptance half.

const fs = require("fs");
const path = require("path");

const BEGIN = "var FLOW_RESERVED_DIRNAME";
const END = "// ===== proj-flow run-graph view — END =====";

function loadLayout() {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const from = source.indexOf(BEGIN);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error("the run-graph region is not in main.js; markers have moved");
  }
  const region = source.slice(from, to);
  // Nothing in the region touches `document`, `fs`, `path` or `window` until a
  // function is called, and this file calls only the pure layout ones.
  const factory = new Function(
    region +
      "\nreturn { flowLayout, FLOW_NODE_W, FLOW_NODE_H, FLOW_COLUMN, FLOW_ROW, FLOW_MAX_ROWS, FLOW_MAX_BAND_RUN };"
  );
  return factory();
}

const L = loadLayout();

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

// --- fixtures --------------------------------------------------------------
// Shaped like the contract: `graph.node.id`, `graph.node.parent_id`, `kind`,
// `ordinal`. Nothing here invents a field the schema does not define.

let counter = 0;

function node(kind, parent, extra) {
  counter += 1;
  return Object.assign(
    {
      "graph.node.id": kind + ":" + counter,
      "graph.node.parent_id": parent,
      "graph.node.name": kind + " " + counter,
      kind: kind,
      ordinal: counter,
      outcome: "completed"
    },
    extra || {}
  );
}

// One session, `turns` orchestrators, each fanning out to `fanout` dispatches
// and converging on a join.
function runGraph(turns, fanout) {
  counter = 0;
  const session = node("session", undefined);
  const nodes = [session];
  for (let t = 0; t < turns; t++) {
    const orchestrator = node("orchestrator", session["graph.node.id"]);
    nodes.push(orchestrator);
    for (let m = 0; m < fanout; m++) {
      nodes.push(node("dispatch", orchestrator["graph.node.id"]));
    }
    nodes.push(node("join", orchestrator["graph.node.id"]));
  }
  return { schema_version: 2, kind: "run", nodes: nodes, edges: [] };
}

// --- the assertions --------------------------------------------------------

function boxes(document) {
  const laid = L.flowLayout(document);
  const out = [];
  for (const n of document.nodes) {
    const point = laid.positions.get(n["graph.node.id"]);
    check(!!point, "every node is positioned: " + n["graph.node.id"]);
    if (point) out.push({ id: n["graph.node.id"], x: point.x, y: point.y });
  }
  return { laid: laid, boxes: out };
}

function assertNoOverlap(document, label) {
  const placed = boxes(document).boxes;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const overlaps =
        a.x < b.x + L.FLOW_NODE_W &&
        b.x < a.x + L.FLOW_NODE_W &&
        a.y < b.y + L.FLOW_NODE_H &&
        b.y < a.y + L.FLOW_NODE_H;
      check(!overlaps, label + ": " + a.id + " overlaps " + b.id);
      if (overlaps) return;
    }
  }
}

// The measured widest fan-out in the live store. A single 21-row column would
// be three times taller than wide, which is the strip-shaped drawing the canvas
// writer's own MAX_ROWS comment records as unreadable at fit-zoom.
(function theWidestMeasuredFanout() {
  const document = runGraph(1, 21);
  const result = boxes(document);
  assertNoOverlap(document, "fan-out 21");

  const members = document.nodes.filter((n) => n.kind === "dispatch");
  const columns = new Set(members.map((n) => result.laid.positions.get(n["graph.node.id"]).x));
  equal(columns.size, 2, "21 members wrap into two columns of at most 12");

  const rowsPerColumn = new Map();
  for (const m of members) {
    const x = result.laid.positions.get(m["graph.node.id"]).x;
    rowsPerColumn.set(x, (rowsPerColumn.get(x) || 0) + 1);
  }
  for (const count of rowsPerColumn.values()) {
    check(count <= L.FLOW_MAX_ROWS, "no column holds more than FLOW_MAX_ROWS members");
  }

  const ratio = result.laid.width / result.laid.height;
  check(
    ratio > 0.4 && ratio < 4,
    "the 21-member drawing stays roughly screen-shaped (aspect " + ratio.toFixed(2) + ")"
  );

  // The orchestrator is left of its members and the join is right of them.
  const orchestrator = document.nodes.find((n) => n.kind === "orchestrator");
  const join = document.nodes.find((n) => n.kind === "join");
  const ox = result.laid.positions.get(orchestrator["graph.node.id"]).x;
  const jx = result.laid.positions.get(join["graph.node.id"]).x;
  for (const m of members) {
    const mx = result.laid.positions.get(m["graph.node.id"]).x;
    check(ox < mx, "the orchestrator is drawn left of every member");
    check(jx > mx, "the join is drawn right of every member");
  }
})();

// Several wide turns in one session: the case where a height estimated from a
// row count is short and the next band lands on the previous one.
(function severalWideTurns() {
  assertNoOverlap(runGraph(6, 21), "six turns of 21");
  assertNoOverlap(runGraph(40, 3), "forty narrow turns (past the band-run wrap)");
  assertNoOverlap(runGraph(1, 1), "a single dispatch");
  assertNoOverlap(runGraph(0, 0), "a session with no turns");
})();

// A dispatch that dispatched again, hanging off the bottom member of a full
// column — the shape that made the previous layout collide.
(function nestedDispatches() {
  const document = runGraph(2, 12);
  const members = document.nodes.filter((n) => n.kind === "dispatch");
  for (const parent of [members[11], members[12], members[23]]) {
    for (let i = 0; i < 5; i++) {
      document.nodes.push(node("dispatch", parent["graph.node.id"]));
    }
  }
  assertNoOverlap(document, "nested dispatches");
})();

// A workflow run with its agents, and a node whose recorded parent is not in
// the document at all.
(function workflowAndOrphans() {
  const document = runGraph(2, 8);
  const session = document.nodes[0];
  const run = node("workflow_run", session["graph.node.id"]);
  document.nodes.push(run);
  for (let i = 0; i < 4; i++) {
    document.nodes.push(node("workflow_agent", run["graph.node.id"]));
  }
  document.nodes.push(node("dispatch", "dispatch:does-not-exist"));
  document.nodes.push(node("dispatch", "dispatch:does-not-exist"));
  assertNoOverlap(document, "workflow run plus orphans");
})();

// Same input, same drawing. A re-render after a file change must not shuffle
// the graph under a reader who was reading it.
(function deterministic() {
  const document = runGraph(3, 21);
  const first = L.flowLayout(document);
  const second = L.flowLayout(document);
  equal(first.width, second.width, "width is stable across two layouts");
  equal(first.height, second.height, "height is stable across two layouts");
  for (const [id, point] of first.positions) {
    const other = second.positions.get(id);
    check(
      other && other.x === point.x && other.y === point.y,
      "position is stable across two layouts: " + id
    );
  }
})();

// --- a plan lays out, and it has no session node ---------------------------
// The layout used to begin by finding the session node and place nothing when
// there was none, which meant a plan drew as a column of orphans. The root is
// now found by structure, so this asserts the structural property rather than
// the kind: everything is placed, and the root is at the origin.
(function aPlanLaysOut() {
  const document = {
    schema_version: 2,
    kind: "plan",
    nodes: [
      { "graph.node.id": "orchestrator:root", kind: "orchestrator", ordinal: 0 },
      {
        "graph.node.id": "orchestrator:turn",
        "graph.node.parent_id": "orchestrator:root",
        kind: "orchestrator",
        ordinal: 0
      },
      {
        "graph.node.id": "dispatch:a",
        "graph.node.parent_id": "orchestrator:turn",
        kind: "dispatch",
        ordinal: 0
      },
      {
        "graph.node.id": "dispatch:b",
        "graph.node.parent_id": "orchestrator:turn",
        kind: "dispatch",
        ordinal: 1
      },
      {
        "graph.node.id": "join:turn",
        "graph.node.parent_id": "orchestrator:turn",
        kind: "join",
        ordinal: 2
      }
    ]
  };
  const laid = L.flowLayout(document);
  equal(laid.positions.size, 5, "every node of a plan is placed");
  const root = laid.positions.get("orchestrator:root");
  equal(root.x, 0, "the plan's root sits in the leftmost column");
  equal(root.y, 0, "the plan's root sits at the top of it");
  assertNoOverlap(document, "a plan document");
})();

// The real store, when one is reachable. Point at it with FLOW_STORE; skipped
// silently when absent, so this file passes on a machine that has never run the
// extractor.
(function theRealStore() {
  const store = process.env.FLOW_STORE;
  if (!store || !fs.existsSync(store)) return;
  let seen = 0;
  for (const project of fs.readdirSync(store, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = path.join(store, project.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".graph.json")) continue;
      const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      assertNoOverlap(document, "real document " + file);
      seen += 1;
    }
  }
  console.log("checked " + seen + " document(s) from " + store);
})();

// Every plan actually on disk, when the directory is reachable.
(function theRealPlans() {
  const dir = process.env.FLOW_PLANS;
  if (!dir || !fs.existsSync(dir)) return;
  let seen = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".plan.json")) continue;
    const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const laid = L.flowLayout(document);
    equal(
      laid.positions.size,
      (document.nodes || []).length,
      "every node of real plan " + file + " is placed"
    );
    assertNoOverlap(document, "real plan " + file);
    seen += 1;
  }
  console.log("checked " + seen + " plan(s) from " + dir);
})();

console.log((checks - failures) + "/" + checks + " layout checks passed");
if (failures) process.exit(1);
