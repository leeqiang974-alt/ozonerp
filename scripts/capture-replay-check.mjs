import fs from "node:fs/promises";
import path from "node:path";
import { parse1688Product } from "../src/collector1688.js";
import { inspect1688CaptureReplay } from "../src/captureReplay.js";

const fixtureName = process.argv[2] || "complete-single";
const root = path.resolve("test", "fixtures", "1688", fixtureName);
try {
  const manifestBytes = await fs.readFile(path.join(root, "manifest.json"));
  const pageBytes = await fs.readFile(path.join(root, "page.html"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const html = pageBytes.toString("utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  // Fixtures do not represent a real crawler task.  Use a deterministic local
  // task identity so the same completion contract can still be checked.
  const fixtureTaskId = `fixture:${fixtureName}`;
  const replayParsed = { ...parsed, capture: { ...parsed.capture, taskId: fixtureTaskId } };
  console.log(JSON.stringify(inspect1688CaptureReplay({ capture: replayParsed.capture, parsed: replayParsed, html })));
} catch (error) {
  console.log(JSON.stringify({ ok: false, fixture: fixtureName, reasonCode: "CAPTURE_REPLAY_FAILED", message: error.message }));
  process.exitCode = 1;
}
