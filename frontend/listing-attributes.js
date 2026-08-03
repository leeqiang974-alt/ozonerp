(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ListingAttributes = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function attributeFieldHtml(attribute, values) {
    const id = escapeHtml(attribute.id);
    const name = escapeHtml(attribute.name);
    const required = attribute.required ? " required" : "";
    const label = `${name}${attribute.required ? "（必填）" : ""}`;
    if (String(attribute.dictionary_id || "")) {
      const listId = `listing-attribute-options-${id}`;
      const options = values.map(dictionaryOptionHtml).join("");
      return `<label class="listing-attribute-field">${label}<input data-listing-attribute="${id}" data-attribute-name="${name}" data-attribute-kind="dictionary" list="${listId}" autocomplete="off" maxlength="100" placeholder="输入至少2个字搜索"${required} /><datalist id="${listId}">${options}</datalist></label>`;
    }
    return `<label class="listing-attribute-field">${label}<input data-listing-attribute="${id}" data-attribute-name="${name}" data-attribute-kind="text" type="text" maxlength="10000"${required} /></label>`;
  }

  function dictionaryOptionHtml(item) {
    const id = String(item.id);
    const value = String(item.value || "");
    return `<option value="${escapeHtml(`${value} · Ozon #${id}`)}" data-value-id="${escapeHtml(id)}" data-value-text="${escapeHtml(value)}"></option>`;
  }

  function createRequestGate() {
    let revision = 0;
    return {
      begin(context) { revision += 1; return { revision, context }; },
      isCurrent(token, context) { return token.revision === revision && token.context === context; },
      invalidate() { revision += 1; },
    };
  }

  function attributePayloadFromEntries(entries) {
    return entries.filter(item => String(item.value || "").trim()).map(item => ({
      attribute_id: String(item.attributeId),
      name: String(item.name),
      value_id: item.kind === "dictionary" && item.valueId ? String(item.valueId) : null,
      value_text: String(item.value),
    }));
  }

  return { attributeFieldHtml, attributePayloadFromEntries, createRequestGate, dictionaryOptionHtml };
});
