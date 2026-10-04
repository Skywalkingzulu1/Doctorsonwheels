/* Sandton Index side-service widget for docsonwheels.co.za.
 *
 * One button (any element with [data-si-open]) opens a search panel that
 * queries the Sandton Index's public search-index.json live. No data is
 * copied: the index stays maintained by the sandton-index pipeline and is
 * fetched here on first open, then cached for 24h. Without JS, triggers
 * behave as plain links to the Index search page.
 */
(function () {
  "use strict";

  var INDEX_URL = "https://skywalkingzulu1.github.io/sandton-index/assets/search-index.json";
  var SEARCH_URL = "https://skywalkingzulu1.github.io/sandton-index/search/";
  var HOME_URL = "https://skywalkingzulu1.github.io/sandton-index/";
  var CACHE_KEY = "si-index-v1";
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var MAX_RESULTS = 12;
  var HEALTH_HUB = "health-wellness";

  var index = null;
  var fetchFailed = false;
  var lastTrigger = null;
  var els = {};
  var booted = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fold(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function track(name, data) {
    try {
      if (window.dataLayer && window.dataLayer.push) {
        window.dataLayer.push(Object.assign({ event: name }, data || {}));
      }
    } catch (e) { /* analytics must never break search */ }
  }

  function build() {
    var overlay = document.createElement("div");
    overlay.className = "si-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="si-panel" role="dialog" aria-modal="true" aria-labelledby="si-title">' +
      '<div class="si-head"><div>' +
      "<h2 id='si-title'>Find care near you</h2>" +
      "<p class='si-sub'>Live listings from the Sandton Index</p>" +
      "</div><button type='button' class='si-close' aria-label='Close search'>&times;</button></div>" +
      "<form class='si-form' role='search'>" +
      "<input type='search' class='si-input' placeholder='Try pharmacy, health, Sandton\u2026' " +
      "aria-label='Search Sandton listings' autocomplete='off' enterkeyhint='search'>" +
      "<button type='submit' class='si-go'>Search</button></form>" +
      "<div class='si-chips' aria-label='Popular searches'>" +
      "<button type='button' class='si-chip' data-q='pharmacy'>Pharmacy</button>" +
      "<button type='button' class='si-chip' data-q='health'>Health</button>" +
      "<button type='button' class='si-chip' data-q='sandton'>Sandton</button>" +
      "</div>" +
      "<label class='si-toggle'><input type='checkbox' class='si-health' checked> " +
      "Health &amp; wellness only</label>" +
      "<div class='si-results' aria-live='polite'></div>" +
      "<div class='si-foot'><span>Powered by " +
      "<a href='" + HOME_URL + "' target='_blank' rel='noopener'>Sandton Index</a></span>" +
      "<a class='si-full' href='" + SEARCH_URL + "' target='_blank' rel='noopener'>Full search &rarr;</a></div>" +
      "</div>";
    document.body.appendChild(overlay);
    els.overlay = overlay;
    els.panel = overlay.firstElementChild;
    els.close = overlay.querySelector(".si-close");
    els.form = overlay.querySelector(".si-form");
    els.input = overlay.querySelector(".si-input");
    els.results = overlay.querySelector(".si-results");
    els.health = overlay.querySelector(".si-health");
    els.full = overlay.querySelector(".si-full");

    els.close.addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) close();
      if (e.key === "Tab" && !overlay.hidden) trapTab(e);
    });
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      run(els.input.value);
    });
    var deb = null;
    els.input.addEventListener("input", function () {
      clearTimeout(deb);
      deb = setTimeout(function () {
        if (els.input.value.trim().length >= 2) run(els.input.value);
        else if (!els.input.value.trim()) hint();
      }, 350);
    });
    overlay.querySelectorAll(".si-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        els.input.value = chip.getAttribute("data-q");
        run(chip.getAttribute("data-q"));
        els.input.focus();
      });
    });
    els.health.addEventListener("change", function () {
      if (els.input.value.trim()) run(els.input.value);
      else hint();
    });
  }

  function trapTab(e) {
    var f = els.panel.querySelectorAll(
      "button, input, a[href], [tabindex]:not([tabindex='-1'])");
    f = Array.prototype.filter.call(f, function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function open(trigger) {
    lastTrigger = trigger || null;
    els.overlay.hidden = false;
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    track("si_widget_open", {});
    if (index) { hint(); els.input.focus(); return; }
    if (fetchFailed) { dead(); els.input.focus(); return; }
    els.results.innerHTML = "<p class='si-hint'>Loading Sandton listings&hellip;</p>";
    els.input.focus();
    loadIndex();
  }

  function close() {
    els.overlay.hidden = true;
    document.body.style.overflow = "";
    if (lastTrigger) {
      lastTrigger.setAttribute("aria-expanded", "false");
      try { lastTrigger.focus(); } catch (e) {}
    }
  }

  function cached() {
    try {
      var raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.t || !c.d || (Date.now() - c.t) > CACHE_TTL) return null;
      return c.d;
    } catch (e) { return null; }
  }

  function store(data) {
    try {
      window.localStorage.setItem(CACHE_KEY,
        JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) { /* private mode etc: memory cache still works */ }
  }

  function loadIndex() {
    var c = cached();
    if (c) { index = c; hint(); return; }
    if (typeof fetch !== "function") { fetchFailed = true; dead(); return; }
    fetch(INDEX_URL, { mode: "cors" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.length) throw new Error("empty index");
      index = d; store(d); hint();
    }).catch(function () { fetchFailed = true; dead(); });
  }

  function hint() {
    var n = index ? index.filter(function (e) {
      return healthOnly() ? e.h === HEALTH_HUB : true;
    }).length : 0;
    els.results.innerHTML = "<p class='si-hint'>Type to search " +
      esc(index ? n + " listings" : "Sandton listings") +
      " &mdash; or try a popular search above.</p>";
  }

  function dead() {
    els.results.innerHTML = "<p class='si-empty'>The live index could not be " +
      "reached. You can still <a href='" + SEARCH_URL + "' target='_blank' " +
      "rel='noopener'>search the full Sandton Index &rarr;</a></p>";
  }

  function healthOnly() {
    return els.health && els.health.checked;
  }

  function score(e, q) {
    var n = fold(e.n), k = fold(e.k || ""), c = fold(e.c || ""),
        z = fold(e.z || "");
    if (n === q) return 0;
    if (n.indexOf(q) === 0) return 1;
    if (n.indexOf(q) !== -1) return 2;
    if (k.indexOf(q) !== -1) return 3;
    if (c.indexOf(q) !== -1) return 4;
    if (z.indexOf(q) !== -1) return 5;
    return -1;
  }

  function highlight(name, q) {
    var i = fold(name).indexOf(q);
    if (i === -1 || !q) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" +
      esc(name.slice(i, i + q.length)) + "</mark>" +
      esc(name.slice(i + q.length));
  }

  function run(rawQ) {
    var q = fold(rawQ.trim());
    els.full.href = SEARCH_URL + "?q=" + encodeURIComponent(rawQ.trim());
    if (!q) { hint(); return; }
    if (!index) {
      if (fetchFailed) dead();
      return;
    }
    track("si_widget_search", { q: rawQ.trim().slice(0, 60) });
    var out = [];
    for (var i = 0; i < index.length; i++) {
      var e = index[i];
      if (healthOnly() && e.h !== HEALTH_HUB) continue;
      var s = score(e, q);
      if (s !== -1) out.push({ e: e, s: s });
    }
    out.sort(function (a, b) {
      return a.s - b.s || (a.e.n < b.e.n ? -1 : 1);
    });
    out = out.slice(0, MAX_RESULTS);
    if (!out.length) {
      els.results.innerHTML = "<p class='si-empty'>Nothing in the index for " +
        "&ldquo;" + esc(rawQ.trim()) + "&rdquo;" +
        (healthOnly() ? " in health &amp; wellness" : "") +
        ". Try the <a href='" + esc(els.full.href) + "' target='_blank' " +
        "rel='noopener'>full Sandton Index search &rarr;</a></p>";
      return;
    }
    els.results.innerHTML = out.map(function (r) {
      var e = r.e;
      return "<a class='si-item' href='" + esc(e.u) + "' target='_blank' " +
        "rel='noopener' data-name='" + esc(e.n) + "'>" +
        "<span class='si-name'>" + highlight(e.n, q) + "</span>" +
        "<span class='si-meta'>" + esc(e.c) + " &middot; " + esc(e.z) + "</span></a>";
    }).join("");
    els.results.querySelectorAll(".si-item").forEach(function (a) {
      a.addEventListener("click", function () {
        track("si_widget_click", { name: a.getAttribute("data-name") });
      });
    });
  }

  function bind() {
    if (booted) return; // script included twice, or boot event fired twice
    booted = true;
    build();
    document.querySelectorAll("[data-si-open]").forEach(function (t) {
      t.setAttribute("aria-haspopup", "dialog");
      t.setAttribute("aria-expanded", "false");
      t.addEventListener("click", function (e) {
        e.preventDefault();
        open(t);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
