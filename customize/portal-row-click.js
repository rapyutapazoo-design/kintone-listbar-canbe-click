(function (root) {
  'use strict';

  var INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"]';
  var ROW_SELECTOR = 'tr, li, [role="row"], [role="listitem"]';
  var MOVE_LIMIT = 10;
  var NAV_GUARD_MS = 500;
  var BOUND_ATTR = 'data-krc-bound';

  function positiveInt(s) {
    return typeof s === 'string' && /^[1-9]\d*$/.test(s) ? s : null;
  }

  function findRecordParam(u) {
    var parts = [];
    if (u.hash && u.hash.length > 1) parts = parts.concat(u.hash.slice(1).split('&'));
    if (u.search && u.search.length > 1) parts = parts.concat(u.search.slice(1).split('&'));
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'record' && kv.length === 2) {
        var id = positiveInt(kv[1]);
        if (id) return id;
      }
    }
    return null;
  }

  function parseRecordHref(href, origin) {
    try {
      if (typeof href !== 'string' || !href) return null;
      var base = new URL(origin);
      var u = new URL(href, base.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.origin !== base.origin) return null;
      var m;
      var info = null;
      if ((m = /^\/k\/(?:guest\/(\d+)\/)?(\d+)\/show$/.exec(u.pathname))) {
        info = { appId: m[2], guestSpaceId: m[1] || null, mobile: false };
      } else if ((m = /^\/k\/(?:guest\/(\d+)\/)?m\/(\d+)\/show$/.exec(u.pathname))) {
        info = { appId: m[2], guestSpaceId: m[1] || null, mobile: true };
      } else if ((m = /^\/k\/m\/guest\/(\d+)\/(\d+)\/show$/.exec(u.pathname))) {
        info = { appId: m[2], guestSpaceId: m[1], mobile: true };
      }
      if (!info) return null;
      var recordId = findRecordParam(u);
      if (!recordId) return null;
      info.recordId = recordId;
      return info;
    } catch (e) {
      return null;
    }
  }

  function collectRecordLinks(row, origin) {
    var out = [];
    var seen = {};
    if (!row || !row.querySelectorAll) return out;
    var links = row.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      var info = parseRecordHref(href, origin);
      if (!info) continue;
      var key = (info.guestSpaceId || '') + ':' + info.appId + ':' + info.recordId;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ key: key, href: href, info: info });
    }
    return out;
  }

  function resolveRowTarget(row, origin) {
    try {
      var links = collectRecordLinks(row, origin);
      if (links.length !== 1) return null;
      return new URL(links[0].href, origin).href;
    } catch (e) {
      return null;
    }
  }

  function toElement(target) {
    if (target && target.nodeType === 3) return target.parentElement || target.parentNode;
    return target && target.nodeType === 1 ? target : null;
  }

  function findRow(target, container) {
    var el = toElement(target);
    if (!el || !el.closest || !container) return null;
    var row = el.closest(ROW_SELECTOR);
    if (!row || row === container || !container.contains(row)) return null;
    return row;
  }

  function hasSelection(doc) {
    try {
      var view = doc.defaultView;
      var sel = view && view.getSelection ? view.getSelection() : null;
      return !!(sel && !sel.isCollapsed && String(sel).length > 0);
    } catch (e) {
      return false;
    }
  }

  function isHeaderRow(row) {
    if (row.closest && row.closest('thead')) return true;
    if (row.tagName === 'TR') {
      var cells = row.children;
      if (cells.length === 0) return false;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].tagName !== 'TH') return false;
      }
      return true;
    }
    return false;
  }

  function shouldIgnoreClick(ev, container) {
    if (!ev || ev.defaultPrevented) return true;
    var isAux = ev.type === 'auxclick';
    if (isAux ? ev.button !== 1 : ev.button !== 0) return true;
    var el = toElement(ev.target);
    if (!el) return true;
    if (el.closest && el.closest(INTERACTIVE)) return true;
    if (el.closest && el.closest('thead')) return true;
    var row = findRow(el, container);
    if (row && isHeaderRow(row)) return true;
    if (hasSelection(el.ownerDocument)) return true;
    return false;
  }

  var nav = {
    open: function (url, newTab) {
      if (newTab) root.open(url, '_blank', 'noopener');
      else root.location.assign(url);
    }
  };

  var bound = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function init(container) {
    if (!container || !root) return false;
    if (bound && bound.has(container)) return false;
    if (container.getAttribute && container.getAttribute(BOUND_ATTR)) return false;
    if (bound) bound.add(container);
    if (container.setAttribute) container.setAttribute(BOUND_ATTR, '1');

    var lastNav = 0;
    var touch = { x: 0, y: 0, moved: false };

    function origin() {
      return root.location.origin;
    }

    function onClick(ev) {
      try {
        if (ev.type === 'click' && touch.moved) return;
        if (shouldIgnoreClick(ev, container)) return;
        if (ev.shiftKey) return;
        var row = findRow(ev.target, container);
        if (!row) return;
        var url = resolveRowTarget(row, origin());
        if (!url) return;
        var now = Date.now();
        if (now - lastNav < NAV_GUARD_MS) {
          ev.preventDefault();
          return;
        }
        lastNav = now;
        ev.preventDefault();
        var newTab = !!(ev.ctrlKey || ev.metaKey || (ev.type === 'auxclick' && ev.button === 1));
        api.nav.open(url, newTab);
      } catch (e) {
        /* 失敗時は標準動作 */
      }
    }

    function markPointer(ev) {
      try {
        var row = findRow(ev.target, container);
        if (!row || !row.style) return;
        if (resolveRowTarget(row, origin())) row.style.cursor = 'pointer';
      } catch (e) {
        /* ignore */
      }
    }

    function onTouchStart(ev) {
      var t = ev.touches && ev.touches[0];
      touch.x = t ? t.clientX : 0;
      touch.y = t ? t.clientY : 0;
      touch.moved = false;
      markPointer(ev);
    }

    function onTouchMove(ev) {
      var t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
      if (!t) return;
      if (Math.abs(t.clientX - touch.x) > MOVE_LIMIT || Math.abs(t.clientY - touch.y) > MOVE_LIMIT) {
        touch.moved = true;
      }
    }

    container.addEventListener('click', onClick, false);
    container.addEventListener('auxclick', onClick, false);
    container.addEventListener('mouseover', markPointer, false);
    container.addEventListener('touchstart', onTouchStart, false);
    container.addEventListener('touchmove', onTouchMove, false);
    container.addEventListener('touchend', onTouchMove, false);
    return true;
  }

  function getContainer() {
    try {
      var c = kintone.portal.getContentSpaceElement();
      if (c) return c;
    } catch (e) { /* next */ }
    try {
      var m = kintone.mobile.portal.getContentSpaceElement();
      if (m) return m;
    } catch (e2) { /* next */ }
    return root && root.document ? root.document.body : null;
  }

  var api = {
    parseRecordHref: parseRecordHref,
    collectRecordLinks: collectRecordLinks,
    resolveRowTarget: resolveRowTarget,
    shouldIgnoreClick: shouldIgnoreClick,
    findRow: findRow,
    init: init,
    getContainer: getContainer,
    nav: nav
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.KintoneRowClick = root.KintoneRowClick || {};
    root.KintoneRowClick.portal = api;
  }

  if (typeof kintone !== 'undefined' && kintone.events) {
    kintone.events.on(['app.portal.show', 'mobile.app.portal.show'], function (event) {
      var c = getContainer();
      if (c) init(c);
      return event;
    });
  }
})(typeof window !== 'undefined' ? window : null);
