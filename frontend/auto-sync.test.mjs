import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createAutoSyncController, resourcesForView } = require("./auto-sync-policy.js");

test("maps each operational page to server-side correction resources", () => {
  assert.deepEqual(resourcesForView("dashboard"), ["products", "fbs_postings"]);
  assert.deepEqual(resourcesForView("orders"), ["fbs_postings", "fbs_product_images"]);
  assert.deepEqual(resourcesForView("products"), ["products"]);
  assert.deepEqual(resourcesForView("shops"), []);
});

test("loads local data before requesting correction and reloads after started work", async () => {
  const events = [];
  const controller = createAutoSyncController({
    post: async (shopId, view) => {
      events.push(`post:${shopId}:${view}`);
      return [{ resource: "products", status: "started" }];
    },
    wait: async () => events.push("wait"),
  });

  await controller.activate({ shopId: "7", view: "products", loadLocal: async () => events.push("local") });

  assert.deepEqual(events, ["local", "post:7:products", "wait", "local"]);
});

test("deduplicates the same shop and view while correction is in flight", async () => {
  let release;
  let posts = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const controller = createAutoSyncController({
    post: async () => { posts += 1; await pending; return [{ resource: "products", status: "fresh" }]; },
  });
  const loadLocal = async () => {};

  const first = controller.activate({ shopId: "7", view: "products", loadLocal });
  const second = controller.activate({ shopId: "7", view: "products", loadLocal });
  await Promise.resolve();
  assert.equal(posts, 1);
  release();
  await Promise.all([first, second]);
});
