(function (PLUGIN_ID) {
  'use strict';

  var ns = (window.KintoneRowClick = window.KintoneRowClick || {});
  var core = ns.core;
  var api = ns.api;

  var config = core.parseConfig(kintone.plugin.app.getConfig(PLUGIN_ID));

  var state = {
    records: [],
    cellMap: new WeakMap(), // cell -> {recordIndex, fieldCode, kind}
    rowMap: new WeakMap(), // tr -> {recordIndex, cells: []}
    appId: null,
    guestSpaceId: null,
    enabled: false,
    hasSubtable: false,
    rangeCells: [] // 範囲内のセル（対象者と確定したときだけ cursor を付ける）
  };
  var generation = 0;
  var cursorCells = []; // 実際に cursor を付けたセル（再表示時に戻す）
  var bound = false;
  var warned = false;
  var originalBg = new WeakMap();
  var originalCursor = new WeakMap(); // cell -> 付ける前のインライン cursor
  var rowTrs = []; // 一覧の表の行（テーブル列の td を集めるために保持）

  var INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"]';

  var nav = {
    open: function (url, newTab) {
      if (newTab) {
        window.open(url, '_blank', 'noopener');
      } else {
        window.location.assign(url);
      }
    }
  };

  function warnOnce(e) {
    if (warned) return;
    warned = true;
    try {
      console.warn('[KintoneRowClick] disabled for this click:', e);
    } catch (x) { /* noop */ }
  }

  function toElement(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function originOpts() {
    return { origin: window.location.origin, appId: state.appId };
  }

  function clearCursor() {
    cursorCells.forEach(function (cell) {
      if (cell && cell.style) {
        cell.style.cursor = originalCursor.has(cell) ? originalCursor.get(cell) : '';
        originalCursor.delete(cell);
      }
    });
    cursorCells = [];
  }

  function applyCursor() {
    clearCursor();
    state.rangeCells.forEach(function (cell) {
      if (cell && cell.style) {
        if (!originalCursor.has(cell)) originalCursor.set(cell, cell.style.cursor);
        cell.style.cursor = 'pointer';
        cursorCells.push(cell);
      }
    });
  }

  function standardLinks(tr) {
    var out = [];
    var anchors = tr.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      // 対応済みセル（リンク型・リッチエディター等）の中の a は標準リンクではない（レコード番号列は除く）
      var mappedCell = findMappedCell(anchors[i], tr);
      if (mappedCell && state.cellMap.get(mappedCell).fieldCode !== '$id') continue;
      var id = core.extractRecordIdFromHref(anchors[i].getAttribute('href'), originOpts());
      if (id !== null) out.push({ el: anchors[i], id: id });
    }
    return out;
  }

  function buildCellMap(event) {
    var records = Array.isArray(event.records) ? event.records : [];
    state.records = records;
    state.cellMap = new WeakMap();
    state.rowMap = new WeakMap();
    state.rangeCells = [];
    state.hasSubtable = false;
    rowTrs = [];
    if (records.length === 0) return;
    var first = records[0] || {};
    state.hasSubtable = Object.keys(first).some(function (c) {
      return first[c] && first[c].type === 'SUBTABLE';
    });
    Object.keys(first).forEach(function (code) {
      var field = first[code];
      var elements;
      try {
        elements = kintone.app.getFieldElements(code);
      } catch (e) {
        elements = null;
      }
      if (!elements || !elements.length) return;
      var kind = core.kindFromField(field && field.type, code, config.lookupFieldCodes);
      var inRange = core.isFieldInRange(config, code);
      for (var i = 0; i < elements.length && i < records.length; i++) {
        var cell = elements[i];
        if (!cell) continue;
        state.cellMap.set(cell, { recordIndex: i, fieldCode: code, kind: kind });
        var tr = cell.closest ? cell.closest('tr') : null;
        if (tr) {
          var row = state.rowMap.get(tr);
          if (!row) {
            row = { recordIndex: i, cells: [] };
            state.rowMap.set(tr, row);
            rowTrs.push(tr);
          }
          if (inRange) row.cells.push(cell);
        }
        if (inRange) state.rangeCells.push(cell);
      }
    });
    collectTableCells();
  }

  // 対応外の td が「テーブル列」として遷移対象になるとき（SUBTABLE あり＋行全体）、
  // 見た目（カーソル・ホバー色）を動作に合わせる。除外領域の列には付けない。
  function collectTableCells() {
    if (!state.hasSubtable || config.range.mode !== 'row') return;
    rowTrs.forEach(function (tr) {
      var row = state.rowMap.get(tr);
      if (!row) return;
      var links = standardLinks(tr);
      for (var i = 0; i < tr.cells.length; i++) {
        var td = tr.cells[i];
        if (state.cellMap.has(td) || findMappedCellIn(td)) continue;
        if (isExcludedColumn(td, links)) continue;
        row.cells.push(td);
        state.rangeCells.push(td);
      }
    });
  }

  function findMappedCellIn(td) {
    var found = false;
    var all = td.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (state.cellMap.has(all[i])) { found = true; break; }
    }
    return found;
  }

  function isExcludedColumn(td, links) {
    return !!(td.querySelector('input[type="checkbox"], button, [role="button"]') ||
      links.some(function (l) { return td.contains(l.el); }));
  }

  function findMappedCell(target, tr) {
    var el = target;
    while (el && el !== tr) {
      if (state.cellMap.has(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function isInlineEditing(tr) {
    var inputs = tr.querySelectorAll('input, textarea, select, [contenteditable="true"]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        var type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'hidden') continue;
      }
      if (el.style && el.style.display === 'none') continue;
      return true;
    }
    return false;
  }

  function hasSelectionInRow(tr) {
    try {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.toString().trim() === '') return false;
      return tr.contains(sel.anchorNode) || tr.contains(sel.focusNode);
    } catch (e) {
      return false;
    }
  }

  function describe(e, target, tr) {
    var mapped = findMappedCell(target, tr);
    var meta = mapped ? state.cellMap.get(mapped) : null;
    var rowInfo = state.rowMap.get(tr);
    if (!rowInfo) return null; // 一覧のデータ行ではない（対応済みセルを持つ行だけ対象）
    var links = standardLinks(tr);

    var td = target.closest('td');
    var inStdLink = false;
    var a = target.closest('a[href]');
    if (a && links.some(function (l) { return l.el === a; })) inStdLink = true;

    var excluded = inStdLink || !!target.closest('input[type="checkbox"], button, [role="button"]');
    if (!excluded && td && !state.cellMap.has(td) && !mapped) {
      // 対応済みでない列: 標準リンク・チェックボックス・ボタンを含む列は行操作用の列とみなす
      if (isExcludedColumn(td, links)) excluded = true;
    }

    var kind = meta ? meta.kind : null;
    var fieldCode = meta ? meta.fieldCode : null;
    var inMapped = !!meta;
    if (!inMapped && !excluded && td && state.hasSubtable && config.range.mode === 'row') {
      kind = 'table';
      fieldCode = null;
    }

    return {
      desc: {
        button: e.type === 'auxclick' ? 1 : e.button,
        ctrlKey: !!e.ctrlKey,
        metaKey: !!e.metaKey,
        shiftKey: !!e.shiftKey,
        hasSelection: hasSelectionInRow(tr),
        inMappedCell: inMapped,
        inExcludedArea: excluded,
        isInlineEditing: isInlineEditing(tr),
        onInteractive: !!target.closest(INTERACTIVE),
        fieldCode: fieldCode,
        kind: kind
      },
      links: links,
      rowInfo: rowInfo,
      meta: meta
    };
  }

  function onClick(e) {
    try {
      if (!state.enabled) return;
      if (e.defaultPrevented) return;
      if (e.type === 'auxclick' && e.button !== 1) return;
      if (e.type === 'click' && e.button !== 0) return;
      var target = toElement(e.target);
      if (!target || !target.closest) return;
      var tr = target.closest('tr');
      if (!tr) return;
      var d = describe(e, target, tr);
      if (!d) return;
      var decision = core.decideClick(d.desc, config);
      if (decision.action !== 'navigate') return;

      var recordId = null;
      var idx = d.meta ? d.meta.recordIndex : d.rowInfo ? d.rowInfo.recordIndex : null;
      if (idx !== null && state.records[idx] && state.records[idx].$id) {
        recordId = state.records[idx].$id.value;
      }
      var stdLink = null;
      if (recordId === null) {
        if (d.links.length) { stdLink = d.links[0]; recordId = stdLink.id; }
      } else if (d.links.length) {
        stdLink = d.links.filter(function (l) { return String(l.id) === String(recordId); })[0] || null;
        // 行の $id と標準リンクの ID が食い違うときは、セルと records の並びがずれている可能性がある。
        // どちらも信用できないので遷移しない（標準動作のまま）。
        if (!stdLink) return;
      }
      var url = core.resolveNavigationUrl({
        standardHref: stdLink ? stdLink.el.getAttribute('href') : null,
        recordId: recordId,
        origin: window.location.origin,
        appId: state.appId,
        guestSpaceId: state.guestSpaceId
      });
      if (!url) return;
      e.preventDefault();
      ns.desktop.nav.open(url, decision.newTab);
    } catch (err) {
      warnOnce(err);
    }
  }

  function setHover(tr, on) {
    var row = state.rowMap.get(tr);
    if (!row) return;
    row.cells.forEach(function (cell) {
      if (on) {
        if (!originalBg.has(cell)) originalBg.set(cell, cell.style.backgroundColor);
        cell.style.backgroundColor = '#f3f8fd';
      } else if (originalBg.has(cell)) {
        cell.style.backgroundColor = originalBg.get(cell);
        originalBg.delete(cell);
      }
    });
  }

  function onOver(e) {
    try {
      if (!state.enabled) return;
      var t = toElement(e.target);
      var tr = t && t.closest ? t.closest('tr') : null;
      if (tr) setHover(tr, true);
    } catch (err) {
      warnOnce(err);
    }
  }

  function onOut(e) {
    try {
      var t = toElement(e.target);
      var tr = t && t.closest ? t.closest('tr') : null;
      if (!tr) return;
      var to = toElement(e.relatedTarget);
      if (to && tr.contains(to)) return;
      setHover(tr, false);
    } catch (err) {
      warnOnce(err);
    }
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', onClick);
    document.addEventListener('auxclick', onClick);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
  }

  async function resolveTarget(myGeneration) {
    try {
      var aff = await api.getMyAffiliation();
      var parentMap = null;
      if (aff && config.target.includeChildOrgs) {
        parentMap = await api.getOrganizationParentMap();
        if (parentMap === null) {
          aff = null; // 親子関係を取れないときは安全側
        }
      }
      if (myGeneration !== generation) return;
      state.enabled = core.isTargetUser(config, aff, parentMap);
      if (state.enabled) applyCursor();
    } catch (e) {
      if (myGeneration === generation) state.enabled = false;
    }
  }

  kintone.events.on('app.record.index.show', function (event) {
    try {
      var currentGeneration = ++generation;
      clearCursor();
      state.enabled = false;
      state.rangeCells = [];
      state.records = [];
      state.cellMap = new WeakMap();
      state.rowMap = new WeakMap();
      if (!core.isViewInScope(config, event)) return event;

      state.appId = kintone.app.getId();
      state.guestSpaceId = core.parseGuestSpaceId(window.location.pathname);
      buildCellMap(event);
      bindOnce();

      if (config.target.mode === 'all') {
        state.enabled = true;
        applyCursor();
      } else {
        resolveTarget(currentGeneration); // 一覧表示は待たせない
      }
    } catch (e) {
      state.enabled = false;
      warnOnce(e);
    }
    return event;
  });

  ns.desktop = {
    nav: nav,
    _getState: function () { return state; }
  };
})(kintone.$PLUGIN_ID);
