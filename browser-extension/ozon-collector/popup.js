(function() {
  const statusDiv = document.getElementById("status");
  document.getElementById("pollBtn").addEventListener("click", function() {
    statusDiv.textContent = "正在检查...";
    chrome.runtime.sendMessage({ type: "OZON_ERP_POLL" });
    setTimeout(updateStatus, 500);
  });
  function updateStatus() {
    chrome.runtime.sendMessage({ type: "OZON_ERP_STATUS" }, function(resp) {
      if (resp && resp.state) {
        const s = resp.state;
        statusDiv.className = "status " + (s.status === "error" ? "error" : s.status === "running" ? "running" : "idle");
        statusDiv.innerHTML = "<b>" + s.message + "</b><br><small>" + (s.lastError || "") + "</small>";
      }
    });
  }
  updateStatus();
  setInterval(updateStatus, 3000);
})();
