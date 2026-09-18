// Self-check for the PRODUCTIVE_DRAFT_ONLY guard. Run: node src/draft-only.test.mjs
import assert from "node:assert/strict";
import { isDraftOnlyMode, enforceDraftOnly } from "./index.js";

delete process.env.PRODUCTIVE_DRAFT_ONLY;
assert.equal(isDraftOnlyMode(), true, "unset env must default to draft-only");

process.env.PRODUCTIVE_DRAFT_ONLY = "false";
assert.equal(isDraftOnlyMode(), false, '"false" must disable draft-only');
delete process.env.PRODUCTIVE_DRAFT_ONLY;

// GET is never touched.
assert.equal(
  enforceDraftOnly({ method: "GET", normalizedPath: "/tasks/1", body: undefined }),
  undefined,
);

// Any write outside /comments is rejected outright.
assert.throws(() =>
  enforceDraftOnly({ method: "PATCH", normalizedPath: "/tasks/1", body: { data: {} } }),
);
assert.throws(() =>
  enforceDraftOnly({ method: "DELETE", normalizedPath: "/comments/1", body: undefined }),
);

// Posting a comment is allowed, but draft:true is forced even if the caller tried to post live.
const forced = enforceDraftOnly({
  method: "POST",
  normalizedPath: "/comments",
  body: { data: { type: "comments", attributes: { body: "hi", draft: false } } },
});
assert.equal(forced.data.attributes.draft, true, "draft:false must be overwritten to true");
assert.equal(forced.data.attributes.body, "hi", "other attributes must survive untouched");

// Explicitly disabling draft-only lets a write through unmodified.
process.env.PRODUCTIVE_DRAFT_ONLY = "false";
const untouched = { data: { type: "comments", attributes: { body: "hi", draft: false } } };
assert.equal(
  enforceDraftOnly({ method: "POST", normalizedPath: "/comments", body: untouched }),
  untouched,
);
delete process.env.PRODUCTIVE_DRAFT_ONLY;

console.log("draft-only guard: all checks passed");
