import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const source = await readFile(
  new URL("../../.github/workflows/publish-desktop-preview.yml", import.meta.url),
  "utf8",
);
const workflow = parse(source);
const steps = workflow.jobs.publish.steps;
const validation = steps.find((step) => step.name === "Validate source and destination").run;
const script = validation
  .split("<<'NODE'\n")[1]
  .split("\nNODE")[0]
  .replace(/^import .*;\n/gm, "");
const validate = new Function("readFileSync", "assert", "process", script);

test("preview publishing requires explicit destination and exact source artifact", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  assert.equal(workflow.permissions.contents, "write");
  assert.match(validation, /\^v\[0-9\]/);
  const download = steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(download.with.name, "ZCode-Codex-${{ inputs.platform }}-${{ env.SOURCE_SHA }}");
  assert.equal(download.with.pattern, undefined);
  const upload = steps.find((step) => step.name === "Verify and publish").run;
  assert.match(upload, /sha256sum --check SHA256SUMS.txt/);
  assert.match(upload, /process.env.RELEASE_TAG/);
  assert.doesNotMatch(upload, /--clobber|v3\.17\.1-codex\.1/);
});

function fixture({
  sha = "a".repeat(40),
  prerelease = true,
  repository = "owner/repo",
  path = ".github/workflows/desktop-packages.yml",
} = {}) {
  const documents = {
    "/tmp/source-run.json": {
      repository: { full_name: repository },
      path,
      head_sha: "a".repeat(40),
    },
    "/tmp/preview-release.json": { isPrerelease: prerelease },
    "/tmp/release-commit.json": { sha },
  };
  return () =>
    validate((file) => JSON.stringify(documents[file]), assert, { env: { GH_REPO: "owner/repo" } });
}

test("only the same repository workflow commit can reach a prerelease", () => {
  assert.doesNotThrow(fixture());
  assert.throws(fixture({ sha: "b".repeat(40) }));
  assert.throws(fixture({ prerelease: false }));
  assert.throws(fixture({ repository: "other/repo" }));
  assert.throws(fixture({ path: ".github/workflows/other.yml" }));
});
