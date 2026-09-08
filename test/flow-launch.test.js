// Where a terminal is allowed to start. `node test/flow-launch.test.js`.
//
// The document-side refusal (`flow-face.test.js`) checks which profile a run
// graph was extracted from. That is a fact about a document that already
// exists, and it cannot see a terminal about to open in a professional vault.
// This file covers the other half: `flowWorkVaultProblem`, called from
// `startShell`, which is the single point every start and every resume passes
// through.
//
// Loaded out of `main.js` rather than reimplemented, for the reason the sibling
// files give: a copy of the function in a test would pass while the plugin did
// something else.

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
      "\nreturn { flowWorkVaultProblem, FLOW_WORK_ROOT_MARKER };"
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

// Windows paths are built rather than typed. A literal backslash in a JS string
// is an escape, and the failure is silent: "C:\Users\x" collapses to "C:Usersx",
// the check finds no work segment, and the test passes while proving nothing.
const BS = String.fromCharCode(92);
function win() {
  return Array.prototype.slice.call(arguments).join(BS);
}

// ---------------------------------------------------------------- refusals

(function refusesTheProfessionalVault() {
  const dir = win("C:", "Users", "someone", "OneDrive - Jumbo Supermarkten B.V", "Vault");
  const problem = F.flowWorkVaultProblem(dir);
  check(problem !== null, "a path through a OneDrive-for-Business root is refused");
  check(
    typeof problem === "string" && problem.indexOf("OneDrive - ") !== -1,
    "the refusal names the directory it refused, so the reason is legible"
  );
  check(
    problem.indexOf("not") !== -1 && problem.indexOf("overridable") !== -1,
    "the refusal says it is not overridable rather than sounding like a setting"
  );
})();

(function refusesASubdirectoryDeepInside() {
  // The marker is a segment anywhere in the path, not just the last one. A
  // terminal three folders down is still inside the work vault.
  const dir = win("C:", "Users", "someone", "OneDrive - Contoso", "Vault", "projects", "q3");
  check(F.flowWorkVaultProblem(dir) !== null, "a nested directory is still inside");
})();

(function refusesForwardSlashesToo() {
  // Obsidian normalises some paths to forward slashes, and a settings file
  // written on one machine can be read on another.
  const dir = "C:/Users/someone/OneDrive - Contoso/Vault";
  check(F.flowWorkVaultProblem(dir) !== null, "forward-slash form is refused identically");
})();

(function refusesAnyEmployerNotJustThisOne() {
  // The marker matches the shape of a OneDrive-for-Business root, deliberately
  // rather than one employer's name. Hardcoding the name would leave the guard
  // silently useless the day the name changes.
  check(
    F.flowWorkVaultProblem(win("D:", "OneDrive - Some Other Company", "Vault")) !== null,
    "an unrelated organisation's OneDrive root is refused"
  );
})();

(function isCaseInsensitive() {
  check(
    F.flowWorkVaultProblem(win("C:", "ONEDRIVE - CONTOSO", "Vault")) !== null,
    "an upper-case spelling is refused; Windows paths are not case-sensitive"
  );
})();

// ---------------------------------------------------------------- allowances

(function allowsThePersonalVault() {
  check(
    F.flowWorkVaultProblem(win("C:", "Users", "someone", "OneDrive", "Vault")) === null,
    "a personal OneDrive is allowed -- it has no ' - <org>' suffix"
  );
})();

(function allowsARepo() {
  check(
    F.flowWorkVaultProblem(win("C:", "Repos", "proj-flow")) === null,
    "a repository outside either vault is allowed"
  );
})();

(function allowsAFolderThatMerelyMentionsOneDrive() {
  // "onedrive - " must begin a segment. A folder called "my-onedrive - notes"
  // is somebody's own directory and is not a work vault.
  check(
    F.flowWorkVaultProblem(win("C:", "notes", "my-onedrive - archive")) === null,
    "the marker must begin a segment, not appear anywhere in one"
  );
})();

(function saysNothingAboutNothing() {
  // A null cwd means the caller has not resolved one yet. Refusing it would
  // turn "not known" into "forbidden", which are different facts.
  check(F.flowWorkVaultProblem(null) === null, "a null directory is not a refusal");
  check(F.flowWorkVaultProblem("") === null, "an empty directory is not a refusal");
})();

// ---------------------------------------------------------------- wiring

(function theGuardIsActuallyCalledAtTheChokePoint() {
  // The function existing proves nothing. This asserts it is invoked in
  // startShell, before lastCwd is written -- persisting a refused directory
  // would re-fire the refusal on every restart and would put the path in a
  // settings file that syncs to the other machine.
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const call = source.indexOf("const boundary = flowWorkVaultProblem(cwd);");
  const persist = source.indexOf("this.plugin.pluginData.lastCwd = cwd;");
  check(call !== -1, "startShell calls flowWorkVaultProblem");
  check(persist !== -1, "startShell still persists lastCwd on the allowed path");
  check(call !== -1 && persist !== -1 && call < persist, "the check runs before the write");
})();

console.log((checks - failures) + "/" + checks + " launch-boundary checks passed");
if (failures) process.exit(1);
