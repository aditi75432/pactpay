/*
 * PactPay Guard: content script.
 *
 * Runs in every page, stays silent unless the page looks like a checkout, then:
 *   1. reads the page with extract.js (code evidence)
 *   2. (optional) asks the background worker for a screenshot, for the AI cross-check
 *   3. sends the evidence to PactPay, which applies the shopper's rules with fixed code
 *   4. shows the verdict in a shadow-DOM card the page can't style or script
 *   5. if the verdict is DO NOT PAY, puts a speed bump in front of the page's pay buttons,
 *      so neither a person nor an AI agent clicks "Place order" by accident.
 *
 * Nothing is sent until a checkout is detected, and only the order summary, hidden text and (with a key) a screenshot.
 */
(function () {
  "use strict";
  if (window.top !== window || window.__pactpayGuardLoaded) return;
  window.__pactpayGuardLoaded = true;

  var X = window.PactPayExtract;
  var DEFAULTS = { baseUrl: (window.PACTPAY_CONFIG && window.PACTPAY_CONFIG.baseUrl) || "http://localhost:3000", key: "", budget: 40, autoCheck: true, screenshots: true, blockPay: true, rulesTitle: "", rules: [] };
  var state = { settings: DEFAULTS, host: null, root: null, running: false, last: null, armed: false, detected: false };

  // ---------- settings ----------
  function loadSettings() {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(DEFAULTS, function (v) { state.settings = Object.assign({}, DEFAULTS, v); resolve(state.settings); }); }
      catch (e) { resolve(DEFAULTS); }
    });
  }

  // ---------- connect bridge (PactPay web app -> extension) ----------
  function appOrigin() { try { return new URL(state.settings.baseUrl).origin; } catch (e) { return null; } }
  function startBridge() {
    if (location.origin !== appOrigin()) return;
    window.postMessage({ source: "pactpay-guard-ext", type: "READY", version: chrome.runtime.getManifest().version }, location.origin);
    window.addEventListener("message", function (ev) {
      if (ev.source !== window || ev.origin !== location.origin) return;
      var d = ev.data;
      if (d && d.source === "pactpay-web" && d.type === "PING") { window.postMessage({ source: "pactpay-guard-ext", type: "READY", version: chrome.runtime.getManifest().version }, location.origin); return; }
      if (d && d.source === "pactpay-web" && d.type === "LINK" && typeof d.code === "string") {
        send({ type: "LINK", code: d.code }).then(function (r) { window.postMessage({ source: "pactpay-guard-ext", type: r && r.ok ? "LINKED" : "LINK_FAILED", error: r && r.error }, location.origin); });
        return;
      }
      if (!d || d.source !== "pactpay-web" || d.type !== "CONNECT" || typeof d.key !== "string" || !/^ppk_[A-Za-z0-9_-]{43}$/.test(d.key)) return;
      chrome.storage.local.set({ key: d.key }, function () {
        state.settings.key = d.key;
        window.postMessage({ source: "pactpay-guard-ext", type: "CONNECTED" }, location.origin);
      });
    });
  }

  // ---------- overlay ----------
  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
    ".dock{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:372px;max-width:calc(100vw - 24px);color:#14251f}",
    ".pill{display:flex;align-items:center;gap:10px;background:#102a22;color:#fff;border:0;border-radius:999px;padding:8px 18px 8px 8px;font:600 14px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(16,42,34,.35);margin-left:auto}",
    ".pill:hover{background:#17382d}.pill .dot{width:22px;height:22px;border-radius:50%;background:#caff53;color:#102a22;display:grid;place-items:center;font-size:13px;font-weight:800}",
    ".card{background:#fff;border:1px solid #dce4dd;border-radius:18px;box-shadow:0 18px 50px rgba(16,42,34,.28);overflow:hidden;animation:in .18s ease-out}",
    "@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
    ".hd{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#f3f5f2;border-bottom:1px solid #e4eae5;font-size:12px;font-weight:700;color:#4c5f57;letter-spacing:.02em}",
    ".hd b{color:#102a22;font-size:13px}.hd .sp{flex:1}.x{background:none;border:0;font-size:20px;line-height:1;color:#7c8882;cursor:pointer;padding:0 2px}",
    ".verdict{padding:16px 16px 12px}.verdict .big{font-size:21px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:0 0 6px}",
    ".verdict p{margin:0;font-size:13px;line-height:1.5;color:#465a52}",
    ".v-safe{background:linear-gradient(#eaf7ec,#fff)}.v-safe .big{color:#1b6b34}",
    ".v-block{background:linear-gradient(#fdeceb,#fff)}.v-block .big{color:#a5281b}",
    ".v-unk{background:linear-gradient(#fff5df,#fff)}.v-unk .big{color:#8a5a00}",
    ".v-busy{background:#fff}.v-busy .big{color:#102a22}",
    ".money{margin:0 16px 10px;border:1px solid #e4eae5;border-radius:12px;padding:6px 12px;font-size:13px}",
    ".money div{display:flex;justify-content:space-between;padding:4px 0;color:#465a52}.money .t{border-top:1px solid #e4eae5;margin-top:3px;padding-top:7px;font-weight:800;color:#14251f;font-size:14px}",
    ".money .bad{color:#a5281b;font-weight:700}",
    ".sec{padding:0 16px 10px}.sec h4{margin:8px 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#7c8882}",
    ".find{border-left:3px solid #d94b3d;background:#fdf3f2;border-radius:6px;padding:8px 10px;margin-bottom:7px;font-size:12px;line-height:1.45;color:#5a1d16}",
    ".find b{display:block;color:#8a2a1e;margin-bottom:3px}.find q{display:block;color:#3b1410;font-style:normal;background:#fff;border-radius:4px;padding:5px 7px;margin:4px 0;word-break:break-word}",
    ".find small{color:#8a5a52}",
    ".why{margin:0;padding:0 0 0 16px;font-size:12px;line-height:1.5;color:#465a52}.why li{margin-bottom:4px}",
    ".foot{display:flex;gap:8px;align-items:center;padding:10px 14px 8px;border-top:1px solid #eef2ee}.foot .btn{white-space:nowrap;flex:1}",
    ".meta2{padding:0 14px 12px;font-size:11px;color:#7c8882;text-align:center}",
    ".dock.left{left:20px;right:auto}.dock.left .pill{margin-left:0}",
    ".btn{border:0;border-radius:10px;padding:9px 13px;font:700 13px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;background:#102a22;color:#fff}.btn.sec2{background:#eef2ee;color:#102a22}",
    ".meta{font-size:11px;color:#7c8882;margin-left:auto;text-align:right;line-height:1.35}",
    ".spin{width:16px;height:16px;border:2.5px solid #cfd8d2;border-top-color:#102a22;border-radius:50%;display:inline-block;vertical-align:-3px;margin-right:8px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}",
    ".gate{position:fixed;inset:0;z-index:2147483646;background:rgba(16,42,34,.55);display:grid;place-items:center;backdrop-filter:blur(2px)}",
    ".gate .box{background:#fff;border-radius:18px;max-width:420px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.4)}",
    ".gate .gh{display:flex;gap:12px;align-items:center;margin-bottom:10px}.gate h3{margin:0;font-size:19px;line-height:1.2;color:#a5281b;letter-spacing:-.01em}.gate .gwhy{background:#fdf3f2;border-left:3px solid #d94b3d;border-radius:6px;padding:8px 10px;font-size:12.5px;color:#5a1d16}.gate p{margin:0 0 16px;font-size:14px;line-height:1.55;color:#33453d}",
    ".gate .row{display:flex;gap:10px;justify-content:flex-end}.btn.danger{background:#fff;color:#a5281b;border:1px solid #e6b9b4}",
    ".lnk{background:none;border:0;padding:0;color:#2f6d3a;font:700 12px ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-decoration:underline}",
    ".rline{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:0 16px 10px;font-size:12px;color:#5b6d65}.rline .lnk{white-space:nowrap}.rline span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".v-info{background:linear-gradient(#eef3f6,#fff)}.v-info .big{color:#1f3d4d}",
    ".modal{position:fixed;inset:0;z-index:2147483647;background:rgba(16,42,34,.6);display:grid;place-items:center;backdrop-filter:blur(3px);padding:16px}",
    ".mbox{background:#fff;border-radius:22px;width:560px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 30px 90px rgba(0,0,0,.45);animation:in .18s ease-out}",
    ".mh{display:flex;gap:12px;align-items:flex-start;padding:22px 24px 6px}.mh .logo{width:38px;height:38px;border-radius:12px;background:#102a22;color:#caff53;display:grid;place-items:center;font-weight:900;font-size:19px;flex:none}",
    ".mh h2{margin:0;font-size:21px;letter-spacing:-.02em;color:#102a22}.mh p{margin:4px 0 0;font-size:13px;line-height:1.5;color:#52665d}.mh .x{margin-left:auto}",
    ".mb{padding:12px 24px 6px}.ta{width:100%;border:1px solid #cdd8d1;border-radius:12px;padding:12px;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#14251f;resize:vertical;min-height:96px}.ta:focus{outline:2px solid #caff53;border-color:#102a22}",
    ".chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 4px}.chip{border:1px solid #cdd8d1;background:#f6f8f6;border-radius:999px;padding:6px 11px;font:600 12px ui-sans-serif,system-ui,sans-serif;color:#2f4a3e;cursor:pointer}.chip:hover{background:#eaf3ec;border-color:#9bb8a4}",
    ".ctx{font-size:12px;color:#6d7a74;margin:8px 0 0}",
    ".mf{display:flex;gap:10px;justify-content:flex-end;align-items:center;padding:14px 24px 22px}.mf .sp{flex:1;font-size:11.5px;color:#7c8882;line-height:1.4}",
    ".rl{display:grid;gap:8px;margin:6px 0 4px}.rr{display:flex;gap:10px;align-items:flex-start;border:1px solid #e1e8e2;border-radius:12px;padding:10px 12px}.rr .t{flex:1;font-size:13.5px;line-height:1.4;color:#14251f}",
    ".bd{font:800 10px ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;border-radius:6px;padding:3px 6px;flex:none;margin-top:1px}.bd.must{background:#102a22;color:#caff53}.bd.nice{background:#e7efe9;color:#2f4a3e}",
    ".tg2{font-size:11px;font-weight:700;border-radius:99px;padding:3px 8px;flex:none;white-space:nowrap}.tg2.yes{background:#dcefe0;color:#1b6b34}.tg2.no{background:#eef0ef;color:#6d7a74}",
    ".note2{font-size:12px;line-height:1.5;color:#52665d;margin:8px 0 0}.warn2{background:#fff5df;border:1px solid #f1d9a0;color:#7a4f00;border-radius:10px;padding:9px 11px;font-size:12.5px;margin:8px 0 0}.err2{background:#fdeceb;border:1px solid #f3c1bb;color:#8a2a1e;border-radius:10px;padding:9px 11px;font-size:12.5px;margin:10px 0 0}",
    ".ok2{width:54px;height:54px;border-radius:50%;background:#dcefe0;color:#1b6b34;display:grid;place-items:center;font-size:28px;font-weight:900;margin:6px 0 10px}",
  ].join("");

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function usd(n, cur) { return n === null || n === undefined ? "not shown" : (cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "INR" ? "₹" : "$") + Number(n).toFixed(2); }


  // The PactPay mark as inline SVG (created with createElementNS, so a store's Content-Security-Policy can't block it).
  function markSvg(size) {
    var NS = "http://www.w3.org/2000/svg";
    function n(tag, attrs) { var e = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    var svg = n("svg", { viewBox: "0 0 64 64", width: String(size), height: String(size), "aria-hidden": "true" });
    svg.style.cssText = "display:block;flex:none";
    svg.appendChild(n("rect", { width: "64", height: "64", rx: "15", fill: "#12301f" }));
    var g = n("g", { transform: "translate(32 32.4) scale(1.12) translate(-33.25 -32)" });
    g.appendChild(n("path", { d: "M19.5 13H35A13.5 13.5 0 0 1 35 40H28V49.5A1.5 1.5 0 0 1 26.5 51H19.5A1.5 1.5 0 0 1 18 49.5V14.5A1.5 1.5 0 0 1 19.5 13Z M35 20a6.5 6.5 0 1 0 .001 0Z", fill: "#F7F3E8", "fill-rule": "evenodd" }));
    g.appendChild(n("circle", { cx: "35", cy: "26.5", r: "3.5", fill: "#C9F55B" }));
    svg.appendChild(g);
    return svg;
  }

  function ensureHost() {
    if (state.host && document.contains(state.host)) return state.root;
    state.host = document.createElement("div");
    state.host.id = "pactpay-guard-host";
    state.root = state.host.attachShadow({ mode: window.__PACTPAY_TEST_OPEN_SHADOW__ ? "open" : "closed" });
    var style = document.createElement("style"); style.textContent = CSS;
    state.root.appendChild(style);
    state.dock = el("div", { class: "dock" });
    state.root.appendChild(state.dock);
    document.documentElement.appendChild(state.host);
    return state.root;
  }

  /** Docks the card on the side of the screen that doesn't cover the order summary. */
  function placeDock() {
    if (!state.dock) return;
    var side = "right";
    try {
      var found = state.lastSummary;
      if (found && found.getBoundingClientRect) {
        var r = found.getBoundingClientRect();
        var coversRight = r.right > window.innerWidth - 400 && r.left < window.innerWidth;
        var leftFree = r.left > 400;
        if (coversRight && leftFree) side = "left";
      }
    } catch (e) { /* keep right */ }
    state.dock.className = "dock" + (side === "left" ? " left" : "");
  }

  function setHostVisible(visible) { if (state.host) state.host.style.display = visible ? "" : "none"; }
  function clearDock() { ensureHost(); while (state.dock.firstChild) state.dock.removeChild(state.dock.firstChild); }

  function showPill(text) {
    clearDock();
    var pill = el("button", { class: "pill", type: "button", "aria-label": "Check this checkout with PactPay Guard" }, [markSvg(24), document.createTextNode(text)]);
    pill.addEventListener("click", function () { runCheck(); });
    state.dock.appendChild(pill);
  }

  function header() {
    var close = el("button", { class: "x", type: "button", "aria-label": "Close", text: "×" });
    close.addEventListener("click", function () { showPill(state.last ? "PactPay Guard" : "Check this checkout"); });
    return el("div", { class: "hd" }, [markSvg(22), el("b", { text: "PactPay Guard" }), el("span", { class: "sp" }), close]);
  }

  function showBusy(message) {
    clearDock();
    state.dock.appendChild(el("div", { class: "card" }, [header(), el("div", { class: "verdict v-busy" }, [el("p", { class: "big" }, [el("span", { class: "spin" }), document.createTextNode(message)]), el("p", { text: "Reading the real page: its itemized charges, its hidden text, and (if you've connected a key) a screenshot." })])]));
  }

  function showError(message) {
    clearDock();
    var retry = el("button", { class: "btn", type: "button", text: "Try again" });
    retry.addEventListener("click", function () { runCheck(); });
    state.dock.appendChild(el("div", { class: "card" }, [header(), el("div", { class: "verdict v-unk" }, [el("p", { class: "big", text: "Couldn't check this page" }), el("p", { text: message })]), el("div", { class: "foot" }, [retry])]));
  }


  function showInfo(title, text) {
    clearDock();
    var again = el("button", { class: "btn", type: "button", text: "Check again" });
    again.addEventListener("click", function () { runCheck(); });
    state.dock.appendChild(el("div", { class: "card" }, [header(), el("div", { class: "verdict v-info" }, [el("p", { class: "big", text: title }), el("p", { text: text })]), el("div", { class: "foot" }, [again])]));
  }

  function showExpired() {
    clearDock();
    var msg = el("p", { text: "Agent keys last 24 hours, so a lost key can't be used for long. Your approved rules are saved. Renew them with one click." });
    var renew = el("button", { class: "btn", type: "button", text: "Renew my rules" });
    var fresh = el("button", { class: "btn sec2", type: "button", text: "Set new rules" });
    renew.addEventListener("click", async function () {
      renew.disabled = true; renew.textContent = "Renewing…";
      var r = await send({ type: "RULES_RENEW" });
      if (r && r.ok) { await loadSettings(); runCheck(); }
      else { renew.disabled = false; renew.textContent = "Renew my rules"; msg.textContent = (r && r.error) || "Couldn't renew. Set your rules again."; }
    });
    fresh.addEventListener("click", function () { openRulesModal(); });
    state.dock.appendChild(el("div", { class: "card" }, [header(), el("div", { class: "verdict v-unk" }, [el("p", { class: "big", text: "Your rules key expired" }), msg]), el("div", { class: "foot" }, [renew, fresh])]));
  }

  function showVerdict(result) {
    var v = result.verdict, cls = v.outcome === "SAFE_TO_PAY" ? "v-safe" : v.outcome === "DO_NOT_PAY" ? "v-block" : "v-unk";
    var title = v.outcome === "SAFE_TO_PAY" ? "Safe to pay" : v.outcome === "DO_NOT_PAY" ? "Do not pay" : "Can't verify";
    var sub = v.outcome === "SAFE_TO_PAY" ? "Everything on this checkout matches the rules you approved." : v.outcome === "DO_NOT_PAY" ? "This checkout doesn't match what you approved. The pay button is on hold." : "Something couldn't be confirmed. Don't pay until it is.";
    var cur = v.observed.currency, ok = v.inspection.arithmetic;
    var money = el("div", { class: "money" }, [
      el("div", {}, [el("span", { text: "Item" }), el("span", { text: usd(v.observed.itemPrice, cur) })]),
      el("div", {}, [el("span", { text: "Shipping" }), el("span", { text: usd(v.observed.shipping, cur) })]),
      el("div", {}, [el("span", { text: "Tax" }), el("span", { text: usd(v.observed.tax, cur) })]),
    ]);
    if (v.observed.fees > 0) money.appendChild(el("div", { class: "bad" }, [el("span", { text: "Other fees" }), el("span", { text: usd(v.observed.fees, cur) })]));
    if (ok.gap !== null && ok.gap > 0.02) money.appendChild(el("div", { class: "bad" }, [el("span", { text: "Not itemized" }), el("span", { text: usd(ok.gap, cur) })]));
    money.appendChild(el("div", { class: "t" }, [el("span", { text: "Total" }), el("span", { text: usd(v.observed.total, cur) })]));

    var children = [header(), el("div", { class: "verdict " + cls }, [el("p", { class: "big", text: title }), el("p", { text: sub })]), money];

    var blocking = v.findings.filter(function (f) { return f.blocking; });
    if (blocking.length) {
      var sec = el("div", { class: "sec" }, [el("h4", { text: "What it found" })]);
      blocking.slice(0, 3).forEach(function (f) {
        sec.appendChild(el("div", { class: "find" }, [el("b", { text: f.title }), el("q", { text: f.excerpt }), el("small", { text: "Hidden how: " + f.how + ". A person can't see this; an AI agent reading the page can." })]));
      });
      children.push(sec);
    }
    var reasons = v.reasons.filter(function (r) { return !/^Invisible text|^A charge is drawn|aimed at an AI agent/.test(r); }).slice(0, 4);
    if (reasons.length) {
      var ul = el("ul", { class: "why" }); reasons.forEach(function (r) { ul.appendChild(el("li", { text: r })); });
      children.push(el("div", { class: "sec" }, [el("h4", { text: "Why" }), ul]));
    }

    var again = el("button", { class: "btn sec2", type: "button", text: "Check again" });
    again.addEventListener("click", function () { runCheck(); });
    var open = el("button", { class: "btn", type: "button", text: "Open Activity" });
    open.addEventListener("click", function () { window.open(state.settings.baseUrl + "/control-center", "_blank", "noopener"); });
    var readers = v.confidence === "cross-checked" ? "Code + AI screenshot agree on the money" : (result.mode === "quick" ? "Code reader only" : "Code reader only (no screenshot)");
    var rulesBtn = el("button", { class: "lnk", type: "button", text: result.mode === "quick" ? "Set my rules" : "Edit rules" });
    rulesBtn.addEventListener("click", function () { openRulesModal(); });
    children.push(el("div", { class: "rline" }, [el("span", { text: result.mode === "quick" ? "Quick Guard · $" + Number(state.settings.budget).toFixed(0) + " budget" : "Rules: " + (result.rulesTitle || "your approved rules") }), rulesBtn]));
    children.push(el("div", { class: "foot" }, [again, open]));
    children.push(el("div", { class: "meta2", text: readers }));
    if (result.visionNote) children.push(el("div", { class: "sec", style: "padding-bottom:12px;font-size:11px;color:#7c8882" }, [document.createTextNode(result.visionNote)]));

    clearDock();
    placeDock();
    state.dock.appendChild(el("div", { class: "card" }, children));
  }

  // ---------- pay-button speed bump ----------
  var PAY_RE = /^(place (your )?order|pay now|complete (your )?(purchase|order)|confirm (order|payment)|buy now|submit order|pay with|pay \$|pay €|pay £)/i;
  function isPayControl(node) {
    var c = node && node.closest ? node.closest("button, input[type=submit], input[type=button], a[role=button], [role=button], a") : null;
    if (!c) return null;
    var label = (c.value || c.textContent || c.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    return PAY_RE.test(label) ? c : null;
  }
  var bypass = false;
  function onClickCapture(ev) {
    if (!state.armed || bypass || ev.target === state.host) return;
    var control = isPayControl(ev.target);
    if (!control) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation();
    showGate(control);
  }
  function showGate(control, form) {
    var gate = el("div", { class: "gate", role: "alertdialog", "aria-modal": "true" });
    var stay = el("button", { class: "btn", type: "button", text: "Don't pay" });
    var anyway = el("button", { class: "btn danger", type: "button", text: "I understand, pay anyway" });
    var why = state.last && state.last.verdict && state.last.verdict.reasons && state.last.verdict.reasons[0] ? state.last.verdict.reasons[0] : "";
    var box = el("div", { class: "box" }, [
      el("div", { class: "gh" }, [markSvg(38), el("h3", { text: "PactPay Guard stopped this payment" })]),
      el("p", { text: "This checkout doesn't match the rules you approved. If an AI agent is shopping for you, it was just stopped too." }),
      why ? el("p", { class: "gwhy", text: why.length > 170 ? why.slice(0, 167) + "..." : why }) : null,
      el("div", { class: "row" }, [anyway, stay]),
    ]);
    gate.appendChild(box); state.root.appendChild(gate);
    stay.addEventListener("click", function () { state.root.removeChild(gate); });
    anyway.addEventListener("click", function () {
      state.root.removeChild(gate); bypass = true;
      try { if (control) control.click(); else if (form && form.requestSubmit) form.requestSubmit(); } finally { setTimeout(function () { bypass = false; }, 0); }
    });
  }
  function arm(on) {
    if (on && !state.armed) { document.addEventListener("click", onClickCapture, true); document.addEventListener("submit", onSubmitCapture, true); }
    if (!on && state.armed) { document.removeEventListener("click", onClickCapture, true); document.removeEventListener("submit", onSubmitCapture, true); }
    state.armed = on;
  }
  function onSubmitCapture(ev) {
    if (!state.armed || bypass) return;
    var form = ev.target; if (!form || !form.querySelector) return;
    var pay = Array.prototype.slice.call(form.querySelectorAll("button, input[type=submit]")).some(function (b) { return PAY_RE.test((b.value || b.textContent || "").replace(/\s+/g, " ").trim()); });
    if (pay) { ev.preventDefault(); ev.stopImmediatePropagation(); showGate(null, form); }
  }


  // ---------- rules modal: say it, review it, approve it, without leaving the page ----------
  function closeModal() { if (state.modal && state.modal.parentNode) state.modal.parentNode.removeChild(state.modal); state.modal = null; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function pageTotal() { try { var o = X.readOrder(document, location); return o.dom.total; } catch (e) { return null; } }

  function openRulesModal() {
    ensureHost(); closeModal();
    var overlay = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Set your PactPay rules" });
    var box = el("div", { class: "mbox" });
    overlay.appendChild(box); state.root.appendChild(overlay); state.modal = overlay;
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    var intentText = "", draft = null;

    function head(title, sub) {
      var x = el("button", { class: "x", type: "button", "aria-label": "Close", text: "×" });
      x.addEventListener("click", closeModal);
      return el("div", { class: "mh" }, [markSvg(42), el("div", {}, [el("h2", { text: title }), el("p", { text: sub })]), x]);
    }
    function foot(children) { return el("div", { class: "mf" }, children); }

    function stepWrite(errorText) {
      clear(box);
      box.appendChild(head("Set your rules", "Say what you want in plain words. PactPay turns it into rules that fixed code enforces at every checkout."));
      var ta = el("textarea", { class: "ta", rows: "4", maxlength: "1200", placeholder: "e.g. Wireless mouse for work, total under $40 including shipping and tax, free returns" });
      ta.value = intentText;
      var total = pageTotal();
      var cap = total ? Math.ceil((total * 1.15) / 5) * 5 : 50;
      var chips = el("div", { class: "chips" });
      ["Total under $" + cap + " including shipping and tax", "Free returns", "Delivery within 7 days", "New condition only"].forEach(function (c) {
        var b = el("button", { class: "chip", type: "button", text: "+ " + c });
        b.addEventListener("click", function () { ta.value = (ta.value.trim() ? ta.value.trim().replace(/[.,]?$/, ", ") : "") + c.toLowerCase().replace(/^total/, "total"); ta.focus(); });
        chips.appendChild(b);
      });
      var body = el("div", { class: "mb" }, [ta, chips]);
      if (total) body.appendChild(el("p", { class: "ctx", text: "You're on " + location.hostname.replace(/^www\./, "") + ", where the order total is " + usd(total, null) + "." }));
      if (errorText) body.appendChild(el("div", { class: "err2", role: "alert", text: errorText }));
      var cancel = el("button", { class: "btn sec2", type: "button", text: "Cancel" });
      var go = el("button", { class: "btn", type: "button", text: "Draft my rules" });
      cancel.addEventListener("click", closeModal);
      go.addEventListener("click", async function () {
        intentText = ta.value.trim();
        if (intentText.length < 8) { stepWrite("Add a few more words: what you're buying and your limits."); return; }
        go.disabled = true; go.textContent = "Drafting…";
        var r = await send({ type: "RULES_DRAFT", intent: intentText });
        if (!r || !r.ok) { stepWrite((r && r.error) || "Couldn't draft rules right now."); return; }
        draft = r.draft; stepReview();
      });
      box.appendChild(body);
      box.appendChild(foot([el("span", { class: "sp", text: "Nothing is saved until you approve." }), cancel, go]));
      ta.focus();
    }

    function ruleRow(kind, text, guardChecks) {
      return el("div", { class: "rr" }, [el("span", { class: "bd " + (kind === "hard" ? "must" : "nice"), text: kind === "hard" ? "MUST" : "NICE" }), el("span", { class: "t", text: text }), el("span", { class: "tg2 " + (guardChecks ? "yes" : "no"), text: guardChecks ? "Guard checks this" : "Shopping agent only" })]);
    }

    function stepReview() {
      clear(box);
      var pact = draft.pact || { constraints: [] };
      var checkable = {}; (draft.checkable || []).forEach(function (r) { checkable[r.id] = r; });
      box.appendChild(head("Review your rules", "These are the rules Guard will hold every checkout to. You decide; no one can change them afterwards, including an AI."));
      var list = el("div", { class: "rl" }), seen = {}, hasHard = false;
      (pact.constraints || []).forEach(function (c) {
        seen[c.id] = 1; if (c.severity === "hard") hasHard = true;
        list.appendChild(ruleRow(c.severity === "hard" ? "hard" : "soft", c.description || c.id, !!checkable[c.id]));
      });
      (draft.checkable || []).forEach(function (r) { if (!seen[r.id]) { if (r.hard) hasHard = true; list.appendChild(ruleRow(r.hard ? "hard" : "soft", r.label, true)); } });
      var body = el("div", { class: "mb" }, [list]);
      body.appendChild(el("p", { class: "note2", text: draft.compiler === "MODEL" ? "Drafted by AI from your words. Check every rule." : "Drafted by PactPay's basic parser (no AI model is configured on this server). Check every rule." }));
      (draft.assumptions || []).slice(0, 3).forEach(function (a) { body.appendChild(el("p", { class: "note2", text: "Assumed: " + a })); });
      (draft.unverifiedRequirements || []).filter(function (a) { return !/catalog|channel3|ineligible/i.test(a); }).slice(0, 3).forEach(function (a) { body.appendChild(el("p", { class: "note2", text: "Can't be checked on a checkout page: " + a })); });
      if (!hasHard) body.appendChild(el("div", { class: "warn2", text: "Add at least one must-have, such as a maximum total. Without one, Guard has nothing to hold the checkout to." }));
      var back = el("button", { class: "btn sec2", type: "button", text: "Edit my words" });
      var ok = el("button", { class: "btn", type: "button", text: "Approve these rules" });
      if (!hasHard) ok.disabled = true;
      back.addEventListener("click", function () { stepWrite(); });
      ok.addEventListener("click", async function () {
        ok.disabled = true; ok.textContent = "Approving…";
        var r = await send({ type: "RULES_APPROVE", pact: draft.pact, originalIntent: intentText, compiler: draft.compiler });
        if (!r || !r.ok) { ok.disabled = false; ok.textContent = "Approve these rules"; var old = body.querySelector(".err2"); if (old) body.removeChild(old); body.appendChild(el("div", { class: "err2", role: "alert", text: (r && r.error) || "Couldn't approve these rules." })); return; }
        await loadSettings(); stepDone(r);
      });
      box.appendChild(body);
      box.appendChild(foot([el("span", { class: "sp", text: "Approving locks these rules." }), back, ok]));
    }

    function stepDone(r) {
      clear(box);
      box.appendChild(head("Rules approved", "Guard will hold every checkout to these, on any store."));
      var body = el("div", { class: "mb" }, [el("div", { class: "ok2", text: "✓" })]);
      var list = el("div", { class: "rl" });
      (r.rules || []).forEach(function (rule) { list.appendChild(ruleRow(rule.hard ? "hard" : "soft", rule.label, true)); });
      body.appendChild(list);
      body.appendChild(el("p", { class: "note2", text: "Your key lasts 24 hours. When it expires Guard offers one-click renewal of these same rules." }));
      var done = el("button", { class: "btn sec2", type: "button", text: "Done" });
      var check = el("button", { class: "btn", type: "button", text: "Check this page now" });
      done.addEventListener("click", closeModal);
      check.addEventListener("click", function () { closeModal(); runCheck(); });
      box.appendChild(body); box.appendChild(foot([done, check]));
    }

    stepWrite();
  }

  // ---------- the check ----------
  function send(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (reply) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(reply);
        });
      } catch (e) { reject(e); }
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Scrolls the order summary into view and hides the card, so the screenshot shows what the shopper sees at checkout. */
  async function captureScreenshot(summaryEl) {
    var y = window.scrollY, x = window.scrollX;
    try {
      setHostVisible(false);
      if (summaryEl && summaryEl.scrollIntoView) summaryEl.scrollIntoView({ block: "center", behavior: "instant" });
      await wait(220);
      var reply = await send({ type: "CAPTURE" });
      return reply && reply.ok ? reply.dataUrl : null;
    } catch (e) { return null; }
    finally { window.scrollTo(x, y); setHostVisible(true); }
  }

  async function runCheck() {
    if (state.running) return;
    state.running = true;
    try {
      await loadSettings();
      showBusy("Checking this checkout…");
      var found = X.extractEvidence(document, window, location);
      state.lastSummary = found.summaryEl;
      if (!found.evidence.dom.readable) {
        showInfo("This doesn't look like a checkout", "Guard checks the cart or payment step, where the order total and charges are shown. Open that step, then press Check again.");
        return;
      }
      var wantsShot = !!state.settings.key && state.settings.screenshots;
      var screenshot = wantsShot ? await captureScreenshot(found.summaryEl) : null;
      var reply = await send({ type: "GUARD_CHECK", url: location.href, evidence: found.evidence, screenshot: screenshot });
      if (!reply || !reply.ok) {
        if (reply && reply.status === 401 && reply.hadKey) showExpired();
        else showError((reply && reply.error) || "PactPay didn't answer. Check the server address in the extension popup.");
        return;
      }
      state.last = reply.result;
      showVerdict(reply.result);
      arm(!!state.settings.blockPay && reply.result.verdict.outcome !== "SAFE_TO_PAY");
      try { chrome.runtime.sendMessage({ type: "BADGE", outcome: reply.result.verdict.outcome }); } catch (e) { /* ignore */ }
    } catch (e) {
      showError(String(e && e.message || e));
    } finally { state.running = false; }
  }

  // ---------- boot ----------
  async function boot() {
    await loadSettings();
    startBridge();
    if (location.origin === appOrigin() && !/^\/store\//.test(location.pathname)) return; // never guard PactPay's own app pages
    var found;
    try { found = X.detectCheckout(document, location); } catch (e) { return; }
    state.detected = found.isCheckout;
    if (!found.isCheckout) return;
    // Pay buttons are on hold from the moment a checkout is detected until a check says otherwise: unknown is never safe.
    if (state.settings.blockPay && state.settings.autoCheck) arm(true);
    showPill(state.settings.autoCheck ? "Checking checkout…" : "Check this checkout");
    if (state.settings.autoCheck) runCheck();
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg && msg.type === "RUN_CHECK") { runCheck(); sendResponse({ ok: true }); }
    if (msg && msg.type === "OPEN_RULES") { openRulesModal(); sendResponse({ ok: true }); }
    if (msg && msg.type === "STATUS") sendResponse({ ok: true, detected: state.detected, last: state.last ? state.last.verdict.outcome : null });
  });

  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
