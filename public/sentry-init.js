(function () {
  "use strict";

  window.__ERP_OBS__ = window.__ERP_OBS__ || {
    track(eventName, payload) {
      try {
        const body = {
          type: "biz_event",
          eventName,
          payload: payload || {},
          ts: new Date().toISOString(),
        };
        console.log("[ERP_EVENT]", body);
      } catch (_) {}
    },
  };

  const dsn = window.localStorage.getItem("ERP_SENTRY_DSN") || "";
  if (!dsn || !window.Sentry) return;
  try {
    window.Sentry.init({
      dsn,
      release: window.localStorage.getItem("ERP_RELEASE") || "ozon-erp@local",
      environment: window.localStorage.getItem("ERP_ENV") || "dev",
      tracesSampleRate: 0.2,
    });
  } catch (_) {}
})();

