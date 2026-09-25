// Self-check for the PRODUCTIVE_DRAFT_ONLY guard. Run: node src/draft-only.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDraftOnlyMode, enforceDraftOnly } from "./index.js";

// Use a real temp .env file, not process.env mutation — this is what the guard actually reads
// now (see isDraftOnlyMode), so the test has to exercise the file, not the cached env snapshot,
// or it would keep passing even if the file-reading behavior silently regressed.
const tmpEnvPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "draft-only-test-")), ".env");
function writeEnv(contents) {
  fs.writeFileSync(tmpEnvPath, contents);
}

delete process.env.PRODUCTIVE_DRAFT_ONLY;

// No file at all: safe default.
fs.rmSync(tmpEnvPath, { force: true });
assert.equal(isDraftOnlyMode(tmpEnvPath), true, "missing .env must default to draft-only");

writeEnv("PRODUCTIVE_DRAFT_ONLY=true\n");
assert.equal(isDraftOnlyMode(tmpEnvPath), true, '"true" must be draft-only');

writeEnv("PRODUCTIVE_DRAFT_ONLY=false\n");
assert.equal(isDraftOnlyMode(tmpEnvPath), false, '"false" must disable draft-only');

writeEnv("PRODUCTIVE_TOKEN=abc\n"); // key absent entirely
assert.equal(isDraftOnlyMode(tmpEnvPath), true, "absent key must default to draft-only");

// The point of the fix: flipping the file changes the result on the very next call, no
// process restart, no re-import — this is what failed before (a stale process kept whatever
// value process.env had at startup, regardless of later file edits).
writeEnv("PRODUCTIVE_DRAFT_ONLY=false\n");
assert.equal(isDraftOnlyMode(tmpEnvPath), false, "editing the file must take effect immediately");
writeEnv("PRODUCTIVE_DRAFT_ONLY=true\n");
assert.equal(isDraftOnlyMode(tmpEnvPath), true, "editing it back must also take effect immediately");

// GET is never touched.
assert.equal(
  enforceDraftOnly({ method: "GET", normalizedPath: "/tasks/1", body: undefined }, tmpEnvPath),
  undefined,
);

// Any write outside /comments is rejected outright, while draft-only is on.
assert.throws(() =>
  enforceDraftOnly({ method: "PATCH", normalizedPath: "/tasks/1", body: { data: {} } }, tmpEnvPath),
);
assert.throws(() =>
  enforceDraftOnly({ method: "DELETE", normalizedPath: "/comments/1", body: undefined }, tmpEnvPath),
);

// Posting a comment is allowed, but draft:true is forced even if the caller tried to post live.
const forced = enforceDraftOnly(
  {
    method: "POST",
    normalizedPath: "/comments",
    body: { data: { type: "comments", attributes: { body: "hi", draft: false } } },
  },
  tmpEnvPath,
);
assert.equal(forced.data.attributes.draft, true, "draft:false must be overwritten to true");
assert.equal(forced.data.attributes.body, "hi", "other attributes must survive untouched");

// Explicitly disabling draft-only lets a write through unmodified.
writeEnv("PRODUCTIVE_DRAFT_ONLY=false\n");
const untouched = { data: { type: "comments", attributes: { body: "hi", draft: false } } };
assert.equal(
  enforceDraftOnly({ method: "POST", normalizedPath: "/comments", body: untouched }, tmpEnvPath),
  untouched,
);

fs.rmSync(path.dirname(tmpEnvPath), { recursive: true, force: true });

console.log("draft-only guard: all checks passed");
