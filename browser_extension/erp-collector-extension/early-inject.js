(() => {
  if (!/(^|\.)1688\.com$/i.test(location.hostname)) return;
  const inject = () => {
    if (document.documentElement?.dataset.ozonErp1688EarlyInjected === "1") return;
    const root = document.documentElement || document.head;
    if (!root) return;
    document.documentElement.dataset.ozonErp1688EarlyInjected = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    root.appendChild(script);
  };
  if (document.documentElement) inject();
  else document.addEventListener("DOMContentLoaded", inject, { once: true });
})();
