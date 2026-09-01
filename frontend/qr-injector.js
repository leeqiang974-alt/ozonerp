// QR Injector - safely adds quick review button to collection box
(function() {
  var itemsCache = [];
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var us = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
    var p = origFetch.apply(this, arguments);
    if (us.indexOf('/collection-box') >= 0) {
      p.then(function(resp) {
        if (resp && resp.ok) {
          var c = resp.clone();
          c.json().then(function(d) {
            if (Array.isArray(d)) {
              itemsCache = d;
              window.__qrItems__ = d;
              setTimeout(injectButtons, 50);
            }
          })['catch'](function() {});
        }
        return resp;
      });
    }
    return p;
  };

  function injectButtons() {
    try {
      var rows = document.querySelectorAll('#cb-rows tr');
      rows.forEach(function(row) {
        if (row.querySelector('.cb-quick-review')) return;
        var edit = row.querySelector('.cb-edit');
        if (!edit) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'link cb-quick-review';
        b.textContent = "Quick Review";
        b.dataset.sp = edit.dataset.sp;
        b.dataset.shop = edit.dataset.shop;
        b.dataset.draft = edit.dataset.draft || '';
        b.addEventListener('click', function() {
          var sp = Number(b.dataset.sp);
          var shop = Number(b.dataset.shop);
          var item = null;
          for (var i = 0; i < itemsCache.length; i++) {
            if (Number(itemsCache[i].source_product_id) === sp && Number(itemsCache[i].shop_id) === shop) {
              item = itemsCache[i]; break;
            }
          }
          if (item && typeof openQuickReview === 'function') {
            openQuickReview(item);
          }
        });
        var td = edit.parentElement;
        td.insertBefore(b, edit);
        td.insertBefore(document.createTextNode(' '), edit);
      });
    } catch(e) { console.warn('[qr-inject]', e); }
  }

  function observe() {
    var target = document.getElementById('cb-rows');
    if (!target) { setTimeout(observe, 500); return; }
    var obs = new MutationObserver(injectButtons);
    obs.observe(target, { childList: true, subtree: true });
  }

  function setupDialog() {
    var d = document.getElementById('cb-quick-review');
    if (!d || d.__qrReady) return;
    d.__qrReady = true;
    try { if (typeof setupQuickReview === 'function') setupQuickReview(); } catch(e) {}
  }

  function init() {
    observe();
    setupDialog();
    setTimeout(setupDialog, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
