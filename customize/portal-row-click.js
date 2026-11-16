(function (root) {
  'use strict';

  var INTERACTIVE = 'a, button, input, select, textarea, label, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], ' +
    '[tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
  var PORTAL_PATH = /^\/k\/(?:guest\/\d+\/)?(?:m\/(?:guest\/\d+\/)?)?$/;
  var ROW_SELECTOR = 'tr, li, [role="row"], [role="listitem"]';
  var MOVE_LIMIT = 10;
  var NAV_GUARD_MS = 500;
  var BOUND_ATTR = 'data-krc-bound';
  var PORTAL_BOUND_ATTR = 'data-krc-portal-bound';
  var CURSOR_ATTR = 'data-krc-cursor';

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

  function parseRecordHref(href, origin, baseHref) {
    try {
      if (typeof href !== 'string' || !href) return null;
      var base = new URL(origin);
      var u = new URL(href, baseHref || base.href);
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

  function collectRecordLinks(row, origin, baseHref) {
    var out = [];
    var seen = {};
    if (!row || !row.querySelectorAll) return out;
    var links = row.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      var info = parseRecordHref(href, origin, baseHref);
      if (!info) continue;
      var key = (info.guestSpaceId || '') + ':' + info.appId + ':' + info.recordId;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ key: key, href: href, info: info });
    }
    return out;
  }

  function resolveRowTarget(row, origin, baseHref) {
    try {
      var links = collectRecordLinks(row, origin, baseHref);
      if (links.length !== 1) return null;
      return new URL(links[0].href, baseHref || origin).href;
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
    var row = findRow(el, container);
    var hit = el.closest ? el.closest(INTERACTIVE) : null;
    if (hit && row && row.contains(hit) && hit !== row) return true;
    if (el.closest && el.closest('thead')) return true;
    if (row && isHeaderRow(row)) return true;
    if (!ev.shiftKey && hasSelection(el.ownerDocument)) return true;
    return false;
  }

  var nav = {
    open: function (url, newTab) {
      if (newTab) root.open(url, '_blank', 'noopener');
      else root.location.assign(url);
    }
  };

  function isPortalLocation(loc) {
    try {
      if (!loc || !PORTAL_PATH.test(loc.pathname)) return false;
      var h = loc.hash || '';
      return h === '' || h === '#' || h === '#/' || /^#\/portal(?:[/?&].*)?$/.test(h);
    } catch (e) {
      return false;
    }
  }

  function markBodyBound(doc) {
    // 診断専用: loading 中のみ DOMContentLoaded を待ち、それ以外は即時に印を試みる
    try {
      var mark = function () {
        if (doc.body) doc.body.setAttribute(BOUND_ATTR, '1');
      };
      if (doc.readyState === 'loading' && doc.addEventListener) {
        doc.addEventListener('DOMContentLoaded', mark, false);
      } else {
        mark();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function init(container) {
    if (!container || !root) return false;
    // 二重登録防止: スクリプトが複数回評価されても documentElement の属性で判定する
    var mark = container.documentElement || container;
    if (mark.getAttribute && mark.getAttribute(PORTAL_BOUND_ATTR)) return false;
    if (mark.setAttribute) mark.setAttribute(PORTAL_BOUND_ATTR, '1');
    markBodyBound(container);

    var lastNav = 0;
    var touch = { x: 0, y: 0, moved: false };
    var mouse = { x: 0, y: 0, down: false };

    function origin() {
      return root.location.origin;
    }

    function baseHref() {
      return (root.document && root.document.baseURI) || root.location.href;
    }

    function onMouseDown(ev) {
      mouse.x = ev.clientX || 0;
      mouse.y = ev.clientY || 0;
      mouse.down = true;
    }

    function mouseMoved(ev) {
      var tracked = mouse.down;
      mouse.down = false;
      // mousedown を伴わない click（キーボード操作・合成 click は detail===0）は移動量を判定しない
      if (!tracked || ev.detail === 0) return false;
      return Math.abs((ev.clientX || 0) - mouse.x) > MOVE_LIMIT || Math.abs((ev.clientY || 0) - mouse.y) > MOVE_LIMIT;
    }

    var lastRow = null;

    function onClick(ev) {
      try {
        if (!isPortalLocation(root.location)) return;
        if (ev.type === 'click' && touch.moved) {
          touch.moved = false;
          return;
        }
        if (mouseMoved(ev)) return;
        if (shouldIgnoreClick(ev, container)) return;
        var row = findRow(ev.target, container);
        if (!row) return;
        var url = resolveRowTarget(row, origin(), baseHref());
        if (!url) return;
        if (ev.shiftKey) {
          try {
            var view = root.document.defaultView;
            if (view && view.getSelection) view.getSelection().removeAllRanges();
          } catch (e2) {
            /* ignore */
          }
        }
        var now = Date.now();
        if (now - lastNav < NAV_GUARD_MS) {
          ev.preventDefault();
          return;
        }
        lastNav = now;
        ev.preventDefault();
        var newTab = !!(ev.ctrlKey || ev.metaKey || ev.shiftKey || (ev.type === 'auxclick' && ev.button === 1));
        api.nav.open(url, newTab);
      } catch (e) {
        /* 失敗時は標準動作 */
      }
    }

    function markPointer(ev) {
      try {
        if (!isPortalLocation(root.location)) return;
        var row = findRow(ev.target, container);
        if (!row || !row.style) {
          lastRow = null;
          return;
        }
        if (row === lastRow) return;
        lastRow = row;
        if (resolveRowTarget(row, origin(), baseHref())) {
          row.style.cursor = 'pointer';
          row.setAttribute(CURSOR_ATTR, '1');
        } else if (row.getAttribute(CURSOR_ATTR)) {
          row.style.cursor = '';
          row.removeAttribute(CURSOR_ATTR);
        }
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

    container.addEventListener('click', onClick, true);
    container.addEventListener('auxclick', onClick, true);
    container.addEventListener('mousedown', onMouseDown, true);
    container.addEventListener('mouseover', markPointer, false);
    container.addEventListener('touchstart', onTouchStart, false);
    container.addEventListener('touchmove', onTouchMove, false);
    container.addEventListener('touchend', onTouchMove, false);
    return true;
  }

  function getContainer() {
    return root && root.document ? root.document : null;
  }

  var api = {
    parseRecordHref: parseRecordHref,
    collectRecordLinks: collectRecordLinks,
    resolveRowTarget: resolveRowTarget,
    shouldIgnoreClick: shouldIgnoreClick,
    findRow: findRow,
    init: init,
    getContainer: getContainer,
    isPortalLocation: isPortalLocation,
    nav: nav
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.KintoneRowClick = root.KintoneRowClick || {};
    if (!root.KintoneRowClick.portal) root.KintoneRowClick.portal = api;
  }

  if (root && root.document) init(root.document);
})(typeof window !== 'undefined' ? window : null);
