import fs from "node:fs/promises";
import path from "node:path";
import { replay1688CaptureFixture } from "../src/captureReplay.js";

// The argument is a fixture directory, never a URL.  A real browser capture
// can be copied into a local directory with manifest.json and page.html;
// replay is strictly offline and emits only hashes/diagnostics.
const fixtureName = process.argv[2] || "complete-single";
const root = path.resolve(process.argv[2]?.includes("/") || process.argv[2]?.includes("\\")
  ? process.argv[2]
  : path.join("test", "fixtures", "1688", fixtureName));
try {
  const manifestBytes = await fs.readFile(path.join(root, "manifest.json"), "utf8");
  const page = await fs.readFile(path.join(root, "page.html"), "utf8");
  const manifest = JSON.parse(manifestBytes);
  const result = replay1688CaptureFixture({
    fixtureName: path.basename(root),
    manifest,
    manifestBytes,
    html: page,
  });
  const output = { ...result, parsed: result.parsed ? { sourceEvidence: result.parsed.sourceEvidence, capture: result.parsed.capture } : null };
  console.log(JSON.stringify(output));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, reasonCode: "FIXTURE_REPLAY_FAILED", message: error.message }));
  process.exitCode = 1;
}
