(function configureErpEndpoint() {
  if (window.ERP_API_BASE) return;

  const host = String(location.hostname || "").trim();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  const privateIpv4 = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3})$/.test(host);

  // HTTPS deployments proxy /api on the same origin. Only a loopback or
  // explicit HTTP private-LAN page uses the separate local API port.
  if (loopback) {
    window.ERP_API_BASE = `http://${host}:8000`;
  } else if (location.protocol === "http:" && privateIpv4) {
    window.ERP_API_BASE = `http://${host}:8000`;
  } else {
    window.ERP_API_BASE = "";
  }
})();
