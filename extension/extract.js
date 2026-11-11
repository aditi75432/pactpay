/*
 * PactPay Guard: the code reader.
 *
 * Reads the page the shopper is looking at and produces EVIDENCE. It never decides anything.
 *   1. dom     what the order summary says: item price, shipping, tax, other fees, total, currency
 *   2. hidden  text that exists in the page but a human can't see (opacity 0, off-screen, 0px font,
 *              same colour as the background, clipped, aria-hidden, comments, long alt/title text)
 *   3. pseudo  text drawn by CSS (::before / ::after), which is visible on screen but not in the page text
 *
 * PactPay's server turns that evidence into a verdict with fixed rules. A page can't talk this file into
 * anything: it only copies text out, bounded in size, and treats every string as untrusted data.
 *
 * Works as a content script (global PactPayExtract) and in Node/jsdom (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PactPayExtract = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_ELEMENTS = 8000;
  var MAX_ITEMS = 40;
  var MAX_TEXT = 400;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, SVG: 1, PATH: 1 };
  var ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

  // ---------- money ----------
  var MONEY_SRC = "(?:US\\$|CA\\$|C\\$|A\\$|AU\\$|[$€£₹])\\s?\\d[\\d.,\\u00a0\\s]*\\d|(?:US\\$|CA\\$|C\\$|A\\$|AU\\$|[$€£₹])\\s?\\d|\\d[\\d.,]*\\s?(?:USD|EUR|GBP|INR|CAD|AUD)\\b";
  var MONEY_RE = new RegExp(MONEY_SRC, "i");

  function currencyOf(raw) {
    var s = String(raw || "");
    if (/€|EUR/i.test(s)) return "EUR";
    if (/£|GBP/i.test(s)) return "GBP";
    if (/₹|INR/i.test(s)) return "INR";
    if (/CA\$|C\$|CAD/i.test(s)) return "CAD";
    if (/AU\$|A\$|AUD/i.test(s)) return "AUD";
    if (/US\$|USD|\$/i.test(s)) return "USD";
    return null;
  }

  /** "$1,299.00" -> 1299, "1.299,00 €" -> 1299, "$24.99" -> 24.99. Returns null if there is no amount. */
  function parseAmount(raw) {
    var m = /(\d[\d.,\u00a0\s]*)/.exec(String(raw || ""));
    if (!m) return null;
    var digits = m[1].replace(/[\u00a0\s]/g, "").replace(/[.,]+$/, "");
    var lastDot = digits.lastIndexOf("."), lastComma = digits.lastIndexOf(",");
    var normalized;
    if (lastDot >= 0 && lastComma >= 0) {
      normalized = lastDot > lastComma ? digits.replace(/,/g, "") : digits.replace(/\./g, "").replace(",", ".");
    } else if (lastComma >= 0) {
      normalized = /,\d{2}$/.test(digits) && digits.indexOf(",") === lastComma ? digits.replace(",", ".") : digits.replace(/,/g, "");
    } else {
      normalized = digits;
    }
    var n = Number(normalized);
    return isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
  }

  // ---------- helpers ----------
  function norm(text) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim(); }
  function clip(text, max) { text = norm(text); return text.length > (max || MAX_TEXT) ? text.slice(0, (max || MAX_TEXT) - 3) + "..." : text; }
  function textOf(el) { return norm(el.textContent); }
  function ownText(el) {
    var out = "";
    for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) out += el.childNodes[i].nodeValue + " ";
    return norm(out);
  }
  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/)[0];
    return s;
  }
  function registrableHost(hostname) {
    var h = String(hostname || "").toLowerCase().replace(/^www\./, "");
    var parts = h.split(".");
    if (parts.length <= 2) return h;
    var twoLevel = /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
    return parts.slice(twoLevel ? -3 : -2).join(".");
  }

  // ---------- order summary ----------
  var LABEL_CHARS = "[A-Za-z][A-Za-z0-9 &/'’.,:\\-#]{1,60}?";
  var ROW_RE = new RegExp("^(" + LABEL_CHARS + ")\\s*[:\\-–]?\\s*(?:\\(?\\s*([-−–])\\s?)?(" + MONEY_SRC + ")\\)?$", "i");
  var FREE_RE = new RegExp("^(" + LABEL_CHARS + ")\\s*[:\\-–]?\\s*(free|no charge|included|complimentary)$", "i");

  var RX = {
    discount: /discount|promo|coupon|saving|rebate|gift card|store credit|credit applied|% off/i,
    total: /^(?:order |grand |final |estimated |cart |new )?total(?: due| payable| to pay| amount| price| cost| today)?$|^(?:amount|balance) due$|^you pay$|^to pay$|^pay today$/i,
    item: /\b(sub-?total|items?|merchandise|products?|cart|before tax|goods)\b/i,
    shipping: /ship|deliver|postage|freight|courier/i,
    tax: /\b(taxes|tax|vat|gst|hst|pst|duty|duties)\b/i,
    fee: /fee|charge|surcharge|handling|processing|service|convenience|insurance|protection|tip|packaging|assembly|installation|warranty|donation/i,
  };

  function classify(label) {
    var L = norm(label.replace(/:$/, ""));
    if (RX.discount.test(L)) return "discount";
    if (RX.total.test(L)) return "total";
    if (RX.item.test(L)) return "item";
    if (RX.shipping.test(L)) return "shipping";
    if (RX.tax.test(L)) return "tax";
    if (RX.fee.test(L)) return "fee";
    return null;
  }

  function collectRows(doc) {
    var rows = [];
    var all = doc.body ? doc.body.querySelectorAll("*") : [];
    var limit = Math.min(all.length, MAX_ELEMENTS);
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      if (SKIP_TAGS[el.tagName]) continue;
      var t = textOf(el);
      if (!t || t.length > 100) continue;
      // Drop short parentheticals like "(2 items)" so a count doesn't look like part of the label.
      var t2 = norm(t.replace(/\((?![^)]*[$€£₹])[^)]{0,40}\)/g, " "));
      var m = ROW_RE.exec(t2);
      var free = false;
      if (!m) { m = FREE_RE.exec(t2); free = !!m; }
      if (!m) continue;
      var label = norm(m[1]);
      var kind = classify(label);
      if (!kind) continue;
      var raw = free ? "free" : m[3];
      var amount = free ? 0 : parseAmount(raw);
      if (amount === null) continue;
      var negative = !free && !!m[2];
      rows.push({ el: el, label: label, kind: kind, amount: amount, negative: negative, raw: raw });
    }
    // Prefer the smallest element for each row (a wrapper with the same text is the same row).
    return rows.filter(function (row, idx) {
      return !rows.some(function (other, j) { return j !== idx && other.label === row.label && other.amount === row.amount && row.el.contains(other.el) && other.el !== row.el; });
    });
  }

  /** The smallest ancestor of the total row that holds at least three money rows: the order summary. */
  function pickSummary(rows) {
    var best = null;
    rows.filter(function (r) { return r.kind === "total"; }).forEach(function (totalRow) {
      var node = totalRow.el;
      while (node && node.parentElement) {
        var inside = rows.filter(function (r) { return node.contains(r.el); });
        if (inside.length >= 3) {
          if (!best || inside.length > best.rows.length) best = { total: totalRow, container: node, rows: inside };
          break;
        }
        node = node.parentElement;
      }
    });
    return best;
  }

  function readReturnWindow(doc) {
    var text = norm(doc.body ? doc.body.textContent : "").slice(0, 60000);
    var m = /(\d{1,3})[- ]day returns?|returns?(?: accepted)? within (\d{1,3}) days|(\d{1,3}) days? to return|(\d{1,3})[- ]day (?:money[- ]back|return)/i.exec(text);
    if (!m) return null;
    var n = Number(m[1] || m[2] || m[3] || m[4]);
    return isFinite(n) && n >= 0 && n <= 3650 ? n : null;
  }

  function visibleNotes(doc, container) {
    var notes = [], seen = {};
    var els = doc.body ? doc.body.querySelectorAll("p, small, li, footer, aside, [class*='note'], [class*='terms'], [class*='disclaimer'], [class*='fine']") : [];
    for (var i = 0; i < els.length && notes.length < 12; i++) {
      var t = ownText(els[i]) || (els[i].children.length === 0 ? textOf(els[i]) : "");
      if (t.length < 30 || t.length > 600 || seen[t]) continue;
      seen[t] = 1;
      notes.push(clip(t));
    }
    return notes;
  }

  function detectCheckout(doc, loc) {
    var reasons = [], score = 0;
    var path = String((loc && (loc.pathname + " " + (loc.search || ""))) || "").toLowerCase();
    if (/checkout|\/cart|basket|\/bag\b|payment|\/pay\b|\/order|\/buy|purchase|gp\/buy|review/.test(path)) { score += 2; reasons.push("url"); }
    var buttons = doc.body ? doc.body.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], [role=button]") : [];
    for (var i = 0; i < buttons.length && i < 400; i++) {
      var label = norm(buttons[i].value || buttons[i].textContent || buttons[i].getAttribute("aria-label") || "");
      if (/^(place (your )?order|pay now|complete (your )?(purchase|order)|confirm (order|payment)|buy now|submit order|pay with)/i.test(label)) { score += 2; reasons.push("pay-button"); break; }
    }
    var rows = collectRows(doc);
    var summary = pickSummary(rows);
    if (summary) { score += 2; reasons.push("order-summary"); }
    return { isCheckout: score >= 4 || (score >= 2 && !!summary), score: score, reasons: reasons, summary: summary };
  }

  function readOrder(doc, loc, found) {
    var host = (loc && loc.hostname) || "";
    var summary = found && found.summary !== undefined ? found.summary : pickSummary(collectRows(doc));
    var dom = {
      merchant: registrableHost(host) || null, currency: null, itemPrice: null, shipping: null, tax: null, otherFees: [], total: null,
      deliveryDate: null, returnWindowDays: readReturnWindow(doc), pageNotes: [], readable: false,
    };
    if (!summary) return { dom: dom, summary: null };
    var rows = summary.rows;
    var firstOf = function (kind) { for (var i = 0; i < rows.length; i++) if (rows[i].kind === kind) return rows[i]; return null; };
    var sub = firstOf("item"), ship = firstOf("shipping"), tax = firstOf("tax");
    var discount = rows.filter(function (r) { return r.kind === "discount"; }).reduce(function (s, r) { return s + r.amount; }, 0);
    dom.total = summary.total.amount;
    dom.currency = currencyOf(summary.total.raw) || currencyOf(sub && sub.raw);
    if (sub) dom.itemPrice = Math.max(0, Math.round((sub.amount - discount) * 100) / 100);
    if (ship) dom.shipping = ship.amount;
    if (tax) dom.tax = tax.amount;
    dom.otherFees = rows.filter(function (r) { return r.kind === "fee"; }).slice(0, 8).map(function (r) { return { label: clip(r.label, 60), amount: r.amount }; });
    dom.pageNotes = visibleNotes(doc, summary.container);
    dom.readable = dom.total !== null;
    return { dom: dom, summary: summary };
  }

  // ---------- hidden text ----------
  var AI_WORDS = /\b(ai|a\.i\.|llm|assistant|agent|bot|model|automated|ignore|disregard|instruction|override|system|do not tell|don'?t tell)\b/i;

  function parseColor(value) {
    var v = String(value || "").trim().toLowerCase();
    var names = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
    if (names[v]) return names[v];
    var m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(v);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/./g, function (c) { return c + c; }) : m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    return null;
  }
  function effectiveBackground(el, win) {
    for (var node = el, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
      var c = parseColor(win.getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0.5) return c;
    }
    return [255, 255, 255, 1];
  }
  function px(value) { var n = parseFloat(value); return isFinite(n) ? n : null; }

  /** Why a human can't see this element's text, or null if they can. */
  function hiddenReason(el, win) {
    var cs = win.getComputedStyle(el);
    // Hidden by an ancestor counts too.
    var depth = 0;
    for (var node = el; node && depth < 8; node = node.parentElement, depth++) {
      var s = node === el ? cs : win.getComputedStyle(node);
      if (s.display === "none") return { how: "display:none", stealth: false };
      if (s.visibility === "hidden" || s.visibility === "collapse") return { how: "visibility:hidden", stealth: false };
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return { how: "aria-hidden", stealth: false };
      if (node.hasAttribute && node.hasAttribute("hidden")) return { how: "hidden attribute", stealth: false };
      var o = parseFloat(s.opacity);
      if (isFinite(o) && o <= 0.05) return { how: "opacity:0", stealth: true };
    }
    var fs = px(cs.fontSize);
    if (fs !== null && fs < 3) return { how: "font-size:" + fs + "px", stealth: true };
    var pos = cs.position;
    if (pos === "absolute" || pos === "fixed") {
      var left = px(cs.left), top = px(cs.top), indent = px(cs.textIndent);
      if ((left !== null && left <= -900) || (top !== null && top <= -900)) return { how: "off-screen", stealth: true };
      if (indent !== null && indent <= -900) return { how: "off-screen", stealth: true };
    }
    var indent2 = px(cs.textIndent);
    if (indent2 !== null && indent2 <= -900) return { how: "off-screen", stealth: true };
    var w = px(cs.width), h = px(cs.height);
    if (cs.overflow === "hidden" && ((w !== null && w <= 1) || (h !== null && h <= 1))) return { how: "clipped to 1px", stealth: true };
    if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(cs.clip || "") || /inset\(\s*(50|100)%/.test(cs.clipPath || "")) return { how: "clipped", stealth: true };
    var fg = parseColor(cs.color), bg = effectiveBackground(el, win);
    if (fg && fg[3] > 0.05 && Math.abs(fg[0] - bg[0]) < 10 && Math.abs(fg[1] - bg[1]) < 10 && Math.abs(fg[2] - bg[2]) < 10) return { how: "same colour as background", stealth: true };
    return null;
  }

  function collectHidden(doc, win) {
    var out = [], seen = {};
    function add(text, how) {
      var t = clip(text);
      var key = how + "|" + t;
      if (!t || seen[key] || out.length >= MAX_ITEMS) return;
      seen[key] = 1;
      out.push({ text: t, how: how });
    }
    if (!doc.body) return out;
    var all = doc.body.querySelectorAll("*");
    var limit = Math.min(all.length, MAX_ELEMENTS);
    for (var i = 0; i < limit && out.length < MAX_ITEMS; i++) {
      var el = all[i];
      if (SKIP_TAGS[el.tagName]) continue;
      var own = ownText(el);
      if (own.length < 20) continue;
      var zw = (own.match(ZERO_WIDTH) || []).length;
      var reason = hiddenReason(el, win);
      if (reason) {
        // display:none / aria-hidden holds a lot of ordinary UI (menus, modals). Only keep it if it reads like an instruction.
        if (!reason.stealth && !AI_WORDS.test(own)) continue;
        add(own, reason.how + " <" + describe(el) + ">");
      } else if (zw >= 6) {
        add(own, "zero-width characters <" + describe(el) + ">");
      }
    }
    // HTML comments: invisible to people, readable by any agent that reads the source.
    try {
      var walker = doc.createTreeWalker(doc.documentElement, 128 /* NodeFilter.SHOW_COMMENT */);
      var count = 0;
      while (walker.nextNode() && count++ < 300) {
        var c = norm(walker.currentNode.nodeValue);
        if (c.length >= 25 && !/^\[if |^\/?ko |^\/?ng-|^\s*react-/.test(c)) add(c, "html-comment");
      }
    } catch (e) { /* ignore */ }
    var attrs = doc.querySelectorAll("[alt],[title],[aria-label]");
    for (var j = 0; j < attrs.length && j < 600 && out.length < MAX_ITEMS; j++) {
      ["alt", "title", "aria-label"].forEach(function (name) {
        var v = attrs[j].getAttribute(name);
        if (v && norm(v).length >= 40 && AI_WORDS.test(v)) add(v, name + " attribute");
      });
    }
    return out;
  }

  // ---------- CSS-drawn text ----------
  function unquoteContent(value) {
    var v = String(value || "").trim();
    if (!v || v === "none" || v === "normal" || v === "initial" || v === "inherit") return "";
    var m = /^(["'])([\s\S]*)\1$/.exec(v);
    if (!m) return ""; // counter(), attr(), url(): not literal text
    return norm(m[2].replace(/\\a/gi, " ").replace(/\\([0-9a-f]{1,6})\s?/gi, function (_, hex) { try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return ""; } }).replace(/\\(.)/g, "$1"));
  }

  /** getPseudo(el, "::after") returns the CSS content value. Injectable so tests can run without a layout engine. */
  function collectPseudo(doc, win, scopeEl, getPseudo) {
    var out = [];
    var scope = scopeEl || doc.body;
    if (!scope) return out;
    var read = getPseudo || function (el, which) { try { return win.getComputedStyle(el, which).getPropertyValue("content"); } catch (e) { return ""; } };
    var nodes = [scope].concat(Array.prototype.slice.call(scope.querySelectorAll("*"), 0, 1500));
    for (var node = scope.parentElement, d = 0; node && d < 3; node = node.parentElement, d++) nodes.push(node);
    nodes.forEach(function (el) {
      if (SKIP_TAGS[el.tagName] || out.length >= MAX_ITEMS) return;
      ["::before", "::after"].forEach(function (which) {
        var text = unquoteContent(read(el, which));
        if (text.length >= 3 && /[A-Za-z0-9]/.test(text)) out.push({ text: clip(text, 160), where: describe(el) + which });
      });
    });
    return out;
  }

  // ---------- everything the server needs ----------
  function extractEvidence(doc, win, loc, getPseudo) {
    var found = detectCheckout(doc, loc);
    var order = readOrder(doc, loc, found);
    var scope = order.summary ? order.summary.container : doc.body;
    return {
      isCheckout: found.isCheckout,
      detectReasons: found.reasons,
      summaryEl: order.summary ? order.summary.container : null,
      evidence: {
        dom: order.dom,
        hidden: collectHidden(doc, win),
        pseudo: collectPseudo(doc, win, scope, getPseudo),
        host: (loc && loc.host) || null,
      },
    };
  }

  return {
    parseAmount: parseAmount, currencyOf: currencyOf, classify: classify, registrableHost: registrableHost,
    detectCheckout: detectCheckout, readOrder: readOrder, collectHidden: collectHidden, collectPseudo: collectPseudo,
    unquoteContent: unquoteContent, extractEvidence: extractEvidence, hiddenReason: hiddenReason,
  };
});
