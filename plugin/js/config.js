(function (PLUGIN_ID) {
  'use strict';

  var ns = (window.KintoneRowClick = window.KintoneRowClick || {});
  var core = ns.core;
  var api = ns.api;

  var KIND_LABELS = {
    link: ['リンク', 'リンクフィールドのクリックで、リンク先を開く'],
    lookup: ['ルックアップ', 'ルックアップ元アプリのレコードへのリンクを開く'],
    file: ['添付ファイル', 'ファイルをダウンロード・プレビューする'],
    entitySelect: ['ユーザー・組織・グループ選択', 'ユーザー情報などを表示する'],
    userMeta: ['作成者・更新者・作業者', 'ユーザー情報などを表示する'],
    richText: ['リッチエディター', '本文中のリンクを開く'],
    table: ['テーブル', 'テーブル内のリンクなどを開く']
  };

  var form = { orgFallback: null, groupFallback: null, viewFallback: null, fieldFallback: null };

  function el(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        e[k] = props[k];
      });
    }
    return e;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  // items: [{value, label}] / selected: value の配列。名前は textContent のみで表示する。
  function renderCheckboxList(container, items, selected, name) {
    clear(container);
    var sel = selected || [];
    (items || []).forEach(function (item) {
      var label = el('label');
      label.className = 'krc-check';
      var input = el('input');
      input.type = 'checkbox';
      input.value = String(item.value);
      if (name) input.name = name;
      input.checked = sel.indexOf(String(item.value)) !== -1;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + item.label));
      container.appendChild(label);
    });
  }

  function renderRadio(container, name, options, current) {
    clear(container);
    options.forEach(function (o) {
      var label = el('label');
      label.className = 'krc-radio';
      var input = el('input');
      input.type = 'radio';
      input.name = name;
      input.value = o.value;
      input.checked = o.value === current;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + o.label));
      container.appendChild(label);
    });
  }

  function renderCodeInput(container, selected) {
    clear(container);
    var ta = el('textarea');
    ta.className = 'krc-textarea';
    ta.rows = 2;
    ta.value = (selected || []).join(',');
    container.appendChild(ta);
    return ta;
  }

  function checkedValues(container) {
    var out = [];
    var inputs = container.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) out.push(inputs[i].value);
    }
    return out;
  }

  function radioValue(container) {
    var r = container.querySelector('input[type="radio"]:checked');
    return r ? r.value : null;
  }

  function parseCodes(text) {
    return String(text || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });
  }

  function readList(container, fallback) {
    return fallback ? parseCodes(fallback.value) : checkedValues(container);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function showError(msg) {
    byId('krc-error').textContent = msg || '';
  }

  function renderKinds(container, priorities) {
    clear(container);
    core.KINDS.forEach(function (kind) {
      var row = el('div');
      row.className = 'krc-kind-row';
      var label = el('div');
      label.className = 'krc-kind-label';
      label.textContent = KIND_LABELS[kind][0] + '（標準: ' + KIND_LABELS[kind][1] + '）';
      var select = el('select');
      select.setAttribute('data-kind', kind);
      var o1 = el('option');
      o1.value = core.PRIORITY.LINK;
      o1.text = 'リンク先（標準動作）優先';
      var o2 = el('option');
      o2.value = core.PRIORITY.DETAIL;
      o2.text = 'レコード詳細優先';
      select.appendChild(o1);
      select.appendChild(o2);
      select.value = priorities[kind] || core.PRIORITY.LINK;
      row.appendChild(label);
      row.appendChild(select);
      container.appendChild(row);
    });
  }

  function collect(current, lookupCodes) {
    var priorities = {};
    var selects = byId('krc-kinds').querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      priorities[selects[i].getAttribute('data-kind')] = selects[i].value;
    }
    return core.normalizeConfig({
      target: {
        mode: radioValue(byId('krc-target-mode')),
        organizations: readList(byId('krc-organizations'), form.orgFallback),
        groups: readList(byId('krc-groups'), form.groupFallback),
        includeChildOrgs: byId('krc-include-child').checked
      },
      views: {
        mode: radioValue(byId('krc-views-mode')),
        viewIds: readList(byId('krc-views'), form.viewFallback)
      },
      range: {
        mode: radioValue(byId('krc-range-mode')),
        fieldCodes: readList(byId('krc-fields'), form.fieldFallback)
      },
      priorities: priorities,
      lookupFieldCodes: lookupCodes || current.lookupFieldCodes
    });
  }

  function validate(cfg) {
    if (cfg.target.mode === 'specified' && cfg.target.organizations.length === 0 && cfg.target.groups.length === 0) {
      return '対象者を「指定」にする場合は、組織またはグループを1つ以上選択してください。';
    }
    if (cfg.views.mode === 'specified' && cfg.views.viewIds.length === 0) {
      return '対象一覧を「指定」にする場合は、一覧を1つ以上選択してください。';
    }
    if (cfg.range.mode === 'fields' && cfg.range.fieldCodes.length === 0) {
      return 'クリック範囲を「指定フィールドの列のみ」にする場合は、フィールドを1つ以上選択してください。';
    }
    return '';
  }

  var SKIP_TYPES = ['LABEL', 'SPACER', 'HR', 'GROUP', 'REFERENCE_TABLE'];

  async function init() {
    var current = core.parseConfig(kintone.plugin.app.getConfig(PLUGIN_ID));
    var appId = kintone.app.getId();

    var res = await Promise.all([
      api.getViews(appId),
      api.getFields(appId),
      api.getAllOrganizations(),
      api.getAllGroups()
    ]);
    var viewsRes = res[0];
    var fieldsRes = res[1];
    var orgs = res[2];
    var groups = res[3];

    renderRadio(byId('krc-target-mode'), 'krc-target', [
      { value: 'all', label: '全員' },
      { value: 'specified', label: '組織・グループを指定' }
    ], current.target.mode);
    byId('krc-include-child').checked = current.target.includeChildOrgs;

    if (orgs && groups) {
      renderCheckboxList(byId('krc-organizations'),
        orgs.map(function (o) { return { value: o.code, label: o.name + ' (' + o.code + ')' }; }),
        current.target.organizations);
      renderCheckboxList(byId('krc-groups'),
        groups.map(function (g) { return { value: g.code, label: g.name + ' (' + g.code + ')' }; }),
        current.target.groups);
    } else {
      byId('krc-target-note').textContent =
        '組織・グループの一覧を取得できなかったため、コードをカンマ区切りで入力してください。';
      form.orgFallback = renderCodeInput(byId('krc-organizations'), current.target.organizations);
      form.groupFallback = renderCodeInput(byId('krc-groups'), current.target.groups);
    }

    renderRadio(byId('krc-views-mode'), 'krc-views-radio', [
      { value: 'all', label: 'すべての表形式一覧' },
      { value: 'specified', label: '指定した一覧のみ' }
    ], current.views.mode);
    if (viewsRes && viewsRes.views) {
      var viewItems = Object.keys(viewsRes.views)
        .map(function (k) { return viewsRes.views[k]; })
        .filter(function (v) { return v && v.type === 'LIST'; })
        .map(function (v) { return { value: v.id, label: v.name }; });
      renderCheckboxList(byId('krc-views'), viewItems, current.views.viewIds);
    } else {
      form.viewFallback = renderCodeInput(byId('krc-views'), current.views.viewIds);
    }

    renderRadio(byId('krc-range-mode'), 'krc-range', [
      { value: 'row', label: '行全体' },
      { value: 'fields', label: '指定フィールドの列のみ' }
    ], current.range.mode);
    var lookupCodes = null;
    if (fieldsRes && fieldsRes.properties) {
      var props = fieldsRes.properties;
      lookupCodes = Object.keys(props).filter(function (c) { return props[c] && props[c].lookup; });
      var fieldItems = Object.keys(props)
        .filter(function (c) { return SKIP_TYPES.indexOf(props[c].type) === -1; })
        .map(function (c) { return { value: c, label: (props[c].label || c) + ' (' + c + ')' }; });
      renderCheckboxList(byId('krc-fields'), fieldItems, current.range.fieldCodes);
    } else {
      form.fieldFallback = renderCodeInput(byId('krc-fields'), current.range.fieldCodes);
    }

    renderKinds(byId('krc-kinds'), current.priorities);

    byId('krc-save').addEventListener('click', function () {
      var cfg = collect(current, lookupCodes);
      var err = validate(cfg);
      if (err) {
        showError(err);
        return;
      }
      showError('');
      kintone.plugin.app.setConfig(core.serializeConfig(cfg), function () {
        window.location.href = '../../flow?app=' + appId;
      });
    });
    byId('krc-cancel').addEventListener('click', function () {
      window.history.back();
    });
  }

  ns.config = {
    renderCheckboxList: renderCheckboxList,
    renderRadio: renderRadio,
    renderCodeInput: renderCodeInput,
    renderKinds: renderKinds,
    collect: collect,
    validate: validate,
    init: init
  };

  if (kintone.app && typeof kintone.app.getId === 'function') {
    init().catch(function (e) {
      showError('設定画面の初期化に失敗しました: ' + (e && e.message ? e.message : e));
    });
  }
})(kintone.$PLUGIN_ID);
