(function () {
  function sendContext() {
    let context = null;
    try {
      context = window.context || null;
    } catch {
      context = null;
    }
    window.postMessage({
      type: "OZON_ERP_1688_CONTEXT",
      context,
      href: location.href,
      title: document.title,
    }, "*");
  }

  sendContext();
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "OZON_ERP_1688_REQUEST_CONTEXT") {
      sendContext();
    }
  });
})();
