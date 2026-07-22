import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendListingEditEvent,
  diffListingFields,
  listListingEditEvents,
  summarizeListingEditJournal,
} from "../src/listingEditJournal.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-listing-journal-test-"));
const tmpFile = path.join(tmpDir, "listing-edit-journal.json");

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  process.env.LISTING_EDIT_JOURNAL_FILE = tmpFile;
}

test("diffListingFields records changed listing fields only", () => {
  const changes = diffListingFields(
    { title: "旧标题", price: "100", categoryId: "10" },
    { title: "新标题", price: "100", categoryId: "20" },
  );

  assert.deepEqual(changes, [
    { field: "title", before: "旧标题", after: "新标题" },
    { field: "categoryId", before: "10", after: "20" },
  ]);
});

test("listing edit journal appends structured manual edit events", async () => {
  reset();

  const event = await appendListingEditEvent({
    candidateId: "cc_1",
    offerId: "SKU1-red",
    productId: "4900000001",
    workflowRunId: "wr_1",
    stage: "ozon_backend_edit",
    source: "ozon_seller_plugin",
    changes: [
      { field: "attribute.9048", before: "SKU1", after: "Автокормушка для кошек" },
    ],
    context: { url: "https://seller.ozon.ru/app/products/4900000001" },
  });

  assert.match(event.id, /^lej_/);
  assert.equal(event.stage, "ozon_backend_edit");
  assert.equal(event.source, "ozon_seller_plugin");
  assert.equal(event.changes[0].field, "attribute.9048");

  const listed = await listListingEditEvents({ offerId: "SKU1-red" });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].candidateId, "cc_1");
});

test("listing edit journal summary groups events by source and stage", async () => {
  reset();
  await appendListingEditEvent({
    candidateId: "cc_1",
    offerId: "SKU1-red",
    stage: "pre_submit_manual_edit",
    source: "erp_manual_form",
    changes: [{ field: "title", before: "A", after: "B" }],
  });
  await appendListingEditEvent({
    candidateId: "cc_1",
    offerId: "SKU1-red",
    stage: "ozon_backend_edit",
    source: "ozon_seller_plugin",
    changes: [{ field: "price", before: "100", after: "120" }],
  });

  const summary = await summarizeListingEditJournal();

  assert.equal(summary.total, 2);
  assert.equal(summary.bySource.erp_manual_form, 1);
  assert.equal(summary.bySource.ozon_seller_plugin, 1);
  assert.equal(summary.byStage.ozon_backend_edit, 1);
  assert.equal(summary.topFields[0].field, "title");
});
