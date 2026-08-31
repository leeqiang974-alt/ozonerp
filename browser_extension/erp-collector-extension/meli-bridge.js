// The ERP uses this lightweight probe before starting a manual recollection.
// Without it, an ERP page opened in a browser without this extension waited for
// thirty seconds and then silently fell back to the server collector.
window.addEventListener("meli-amazon-extension-probe", () => {
  window.dispatchEvent(new CustomEvent("meli-amazon-extension-ready"));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MELI_AMAZON_DRAFT_READY") {
    window.dispatchEvent(new CustomEvent("meli-amazon-draft-ready", {
      detail: { draftId: Number(message.draftId) || null },
    }));
  }
});

window.addEventListener("meli-amazon-recollect", async (event) => {
  const detail = event.detail || {};
  if (!detail.sourceProductId || !detail.sourceUrl) return;
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      type: "MELI_AMAZON_RECOLLECT",
      sourceProductId: detail.sourceProductId,
      sourceUrl: detail.sourceUrl,
    });
  } catch (error) {
    result = { ok: false, error: error?.message || "本机采集插件未响应" };
  }
  window.dispatchEvent(new CustomEvent("meli-amazon-recollect-result", {
    detail: { sourceProductId: detail.sourceProductId, ok: Boolean(result?.ok), error: result?.error || "", quality: result?.data?.quality || null },
  }));
});
