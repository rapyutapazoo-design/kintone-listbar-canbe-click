'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../plugin/js/core.js');

const ORIGIN = 'https://example.cybozu.com';

function cfg(patch) {
  const c = core.DEFAULT_CONFIG();
  return Object.assign(c, patch || {});
}

describe('config', () => {
  it('既定値は全種別 link・全員・すべて・行全体', () => {
    const d = core.DEFAULT_CONFIG();
    assert.equal(d.target.mode, 'all');
    assert.equal(d.views.mode, 'all');
    assert.equal(d.range.mode, 'row');
    assert.equal(core.KINDS.length, 7);
    core.KINDS.forEach((k) => assert.equal(d.priorities[k], 'link'));
    assert.notEqual(core.DEFAULT_CONFIG(), core.DEFAULT_CONFIG());
  });

  it('serialize -> parse の往復で一致する', () => {
    const c = core.DEFAULT_CONFIG();
    c.target = { mode: 'specified', organizations: ['a'], groups: ['g'], includeChildOrgs: true };
    c.views = { mode: 'specified', viewIds: ['1', '2'] };
    c.range = { mode: 'fields', fieldCodes: ['f1'] };
    c.priorities.link = 'detail';
    c.lookupFieldCodes = ['lk'];
    const s = core.serializeConfig(c);
    assert.equal(typeof s.config, 'string');
    assert.deepEqual(core.parseConfig(s), c);
  });

  it('壊れた JSON・null・キー欠落は既定値', () => {
    const d = core.DEFAULT_CONFIG();
    assert.deepEqual(core.parseConfig({ config: '{bad' }), d);
    assert.deepEqual(core.parseConfig(null), d);
    assert.deepEqual(core.parseConfig({}), d);
    assert.deepEqual(core.parseConfig(undefined), d);
    assert.deepEqual(core.parseConfig({ config: 'null' }), d);
  });

  it('不正な enum と型違いは正規化される', () => {
    const n = core.normalizeConfig({
      target: { mode: 'x', organizations: 'a', groups: ['g', 1, 'g'], includeChildOrgs: 'yes' },
      views: { mode: 'specified', viewIds: [1, 'a', 1] },
      range: { mode: 5, fieldCodes: [null, 'f'] },
      priorities: { link: 'detail', file: 'zzz', unknown: 'detail' },
      lookupFieldCodes: 'x',
      extra: 1
    });
    assert.equal(n.target.mode, 'all');
    assert.deepEqual(n.target.organizations, []);
    assert.deepEqual(n.target.groups, ['g']);
    assert.equal(n.target.includeChildOrgs, false);
    assert.deepEqual(n.views.viewIds, ['1', 'a']);
    assert.equal(n.range.mode, 'row');
    assert.deepEqual(n.range.fieldCodes, ['f']);
    assert.equal(n.priorities.link, 'detail');
    assert.equal(n.priorities.file, 'link');
    assert.equal('unknown' in n.priorities, false);
    assert.equal('extra' in n, false);
    assert.deepEqual(n.lookupFieldCodes, []);
  });
});

describe('kindFromField', () => {
  it('7種別と対象外', () => {
    assert.equal(core.kindFromField('LINK', 'a', []), 'link');
    assert.equal(core.kindFromField('FILE', 'a', []), 'file');
    ['USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT'].forEach((t) =>
      assert.equal(core.kindFromField(t, 'a', []), 'entitySelect'));
    ['CREATOR', 'MODIFIER', 'STATUS_ASSIGNEE'].forEach((t) =>
      assert.equal(core.kindFromField(t, 'a', []), 'userMeta'));
    assert.equal(core.kindFromField('RICH_TEXT', 'a', []), 'richText');
    assert.equal(core.kindFromField('SUBTABLE', 'a', []), 'table');
    assert.equal(core.kindFromField('SINGLE_LINE_TEXT', 'a', []), null);
    assert.equal(core.kindFromField('__ID__', '$id', []), null);
  });
  it('ルックアップはコード指定が優先', () => {
    assert.equal(core.kindFromField('SINGLE_LINE_TEXT', 'lk', ['lk']), 'lookup');
    assert.equal(core.kindFromField('LINK', 'lk', ['lk']), 'lookup');
  });
});

describe('isViewInScope / isFieldInRange', () => {
  it('list 以外は false', () => {
    const c = cfg();
    assert.equal(core.isViewInScope(c, { viewType: 'calendar', viewId: 1 }), false);
    assert.equal(core.isViewInScope(c, { viewType: 'custom', viewId: 1 }), false);
    assert.equal(core.isViewInScope(c, { viewType: 'list', viewId: 1 }), true);
  });
  it('指定一覧', () => {
    const c = cfg({ views: { mode: 'specified', viewIds: ['123'] } });
    assert.equal(core.isViewInScope(c, { viewType: 'list', viewId: 123 }), true);
    assert.equal(core.isViewInScope(c, { viewType: 'list', viewId: '123' }), true);
    assert.equal(core.isViewInScope(c, { viewType: 'list', viewId: 124 }), false);
  });
  it('範囲', () => {
    assert.equal(core.isFieldInRange(cfg(), 'x'), true);
    assert.equal(core.isFieldInRange(cfg(), null), true);
    const f = cfg({ range: { mode: 'fields', fieldCodes: ['a'] } });
    assert.equal(core.isFieldInRange(f, 'a'), true);
    assert.equal(core.isFieldInRange(f, 'b'), false);
    assert.equal(core.isFieldInRange(f, null), false);
  });
});

describe('decideClick', () => {
  const base = {
    button: 0, ctrlKey: false, metaKey: false, shiftKey: false,
    hasSelection: false, inMappedCell: true, inExcludedArea: false,
    isInlineEditing: false, onInteractive: false, fieldCode: 'f', kind: null
  };
  const d = (patch, c) => core.decideClick(Object.assign({}, base, patch), c || cfg());

  it('通常クリックは navigate', () => {
    assert.equal(d({}).action, 'navigate');
    assert.equal(d({}).newTab, false);
  });
  it('none になる条件', () => {
    assert.equal(d({ button: 2 }).action, 'none');
    assert.equal(d({ shiftKey: true }).action, 'none');
    assert.equal(d({ shiftKey: true }).reason, 'shift');
    assert.equal(d({ inExcludedArea: true }).action, 'none');
    assert.equal(d({ isInlineEditing: true }).action, 'none');
    assert.equal(d({ hasSelection: true }).action, 'none');
    assert.equal(d({ inMappedCell: false }).action, 'none');
    assert.equal(d({}, cfg({ range: { mode: 'fields', fieldCodes: ['z'] } })).action, 'none');
  });
  it('テーブル種別は対象セル外でも対象', () => {
    assert.equal(d({ inMappedCell: false, kind: null }).action, 'none');
    assert.equal(d({ inMappedCell: false, kind: 'table', fieldCode: null }).action, 'navigate');
    assert.equal(d({ inMappedCell: false, kind: 'table', fieldCode: null, onInteractive: true }).action, 'none');
    const fields = cfg({ range: { mode: 'fields', fieldCodes: ['a'] } });
    assert.equal(d({ inMappedCell: false, kind: 'table', fieldCode: null }, fields).action, 'none');
  });
  it('リンク優先と詳細優先', () => {
    assert.equal(d({ kind: 'link', onInteractive: true }).action, 'none');
    assert.equal(d({ kind: 'link', onInteractive: false }).action, 'navigate');
    const detail = cfg();
    detail.priorities.link = 'detail';
    assert.equal(d({ kind: 'link', onInteractive: true }, detail).action, 'navigate');
  });
  it('種別なしセルは onInteractive でも navigate', () => {
    assert.equal(d({ kind: null, onInteractive: true }).action, 'navigate');
  });
  it('newTab', () => {
    assert.equal(d({ ctrlKey: true }).newTab, true);
    assert.equal(d({ metaKey: true }).newTab, true);
    assert.equal(d({ button: 1 }).newTab, true);
    assert.equal(d({ button: 1 }).action, 'navigate');
  });
});

describe('isTargetUser / collectAncestorCodes', () => {
  const spec = (patch) => {
    const c = cfg();
    c.target = Object.assign({ mode: 'specified', organizations: [], groups: [], includeChildOrgs: false }, patch);
    return c;
  };
  it('all は affiliation が null でも true', () => {
    assert.equal(core.isTargetUser(cfg(), null), true);
  });
  it('specified で affiliation null は false', () => {
    assert.equal(core.isTargetUser(spec({ organizations: ['a'] }), null), false);
  });
  it('組織・グループ一致と不一致', () => {
    const aff = { orgCodes: ['o1'], groupCodes: ['g1'] };
    assert.equal(core.isTargetUser(spec({ organizations: ['o1'] }), aff), true);
    assert.equal(core.isTargetUser(spec({ groups: ['g1'] }), aff), true);
    assert.equal(core.isTargetUser(spec({ organizations: ['o2'], groups: ['g2'] }), aff), false);
  });
  it('下位組織を含める', () => {
    const aff = { orgCodes: ['child'], groupCodes: [] };
    const map = { child: 'mid', mid: 'root' };
    assert.equal(core.isTargetUser(spec({ organizations: ['root'], includeChildOrgs: true }), aff, map), true);
    assert.equal(core.isTargetUser(spec({ organizations: ['root'], includeChildOrgs: false }), aff, map), false);
  });
  it('祖先収集: 多段・循環・親なし', () => {
    assert.deepEqual(core.collectAncestorCodes(['c'], { c: 'b', b: 'a' }).sort(), ['a', 'b', 'c']);
    assert.deepEqual(core.collectAncestorCodes(['a'], { a: 'b', b: 'a' }).sort(), ['a', 'b']);
    assert.deepEqual(core.collectAncestorCodes(['x'], {}), ['x']);
    assert.deepEqual(core.collectAncestorCodes([], {}), []);
  });
});

describe('fetchAllPages', () => {
  const make = (total) => {
    const calls = [];
    const fn = async (offset, size) => {
      calls.push(offset);
      const n = Math.max(0, Math.min(size, total - offset));
      return Array.from({ length: n }, (_, i) => offset + i);
    };
    return { fn, calls };
  };
  it('0件', async () => {
    const m = make(0);
    assert.deepEqual(await core.fetchAllPages(m.fn), []);
    assert.deepEqual(m.calls, [0]);
  });
  it('ちょうど100件は次ページも確認', async () => {
    const m = make(100);
    assert.equal((await core.fetchAllPages(m.fn)).length, 100);
    assert.deepEqual(m.calls, [0, 100]);
  });
  it('250件は3ページ目で停止', async () => {
    const m = make(250);
    assert.equal((await core.fetchAllPages(m.fn)).length, 250);
    assert.deepEqual(m.calls, [0, 100, 200]);
  });
  it('max で停止', async () => {
    const m = make(100000);
    const r = await core.fetchAllPages(m.fn, { size: 100, max: 300 });
    assert.equal(r.length, 300);
  });
});

describe('URL', () => {
  it('buildRecordUrl', () => {
    assert.equal(core.buildRecordUrl({ origin: ORIGIN, appId: 5, recordId: '12' }), ORIGIN + '/k/5/show#record=12');
    assert.equal(
      core.buildRecordUrl({ origin: ORIGIN, appId: '5', recordId: 12, guestSpaceId: '3' }),
      ORIGIN + '/k/guest/3/5/show#record=12');
    assert.equal(core.buildRecordUrl({ origin: ORIGIN, appId: 5, recordId: 'abc' }), null);
    assert.equal(core.buildRecordUrl({ origin: ORIGIN, appId: 0, recordId: 1 }), null);
    assert.equal(core.buildRecordUrl({ origin: ORIGIN, appId: 5, recordId: '1/../x' }), null);
    assert.equal(core.buildRecordUrl({ origin: 'javascript:alert(1)', appId: 5, recordId: 1 }), null);
    assert.equal(core.buildRecordUrl({ origin: ORIGIN, appId: 5, recordId: 1, guestSpaceId: 'x' }), null);
  });
  it('parseGuestSpaceId', () => {
    assert.equal(core.parseGuestSpaceId('/k/guest/12/5/'), '12');
    assert.equal(core.parseGuestSpaceId('/k/5/'), null);
  });
  it('extractRecordIdFromHref', () => {
    const o = { origin: ORIGIN, appId: 5 };
    assert.equal(core.extractRecordIdFromHref('/k/5/show#record=12&l.view=1', o), '12');
    assert.equal(core.extractRecordIdFromHref(ORIGIN + '/k/5/show#record=12', o), '12');
    assert.equal(core.extractRecordIdFromHref('/k/guest/3/5/show#record=7', o), '7');
    assert.equal(core.extractRecordIdFromHref('https://evil.example.com/k/5/show#record=12', o), null);
    assert.equal(core.extractRecordIdFromHref('javascript:alert(1)', o), null);
    assert.equal(core.extractRecordIdFromHref('/k/6/show#record=12', o), null);
    assert.equal(core.extractRecordIdFromHref('/k/5/show#record=1abc', o), null);
    assert.equal(core.extractRecordIdFromHref('/k/5/show', o), null);
    assert.equal(core.extractRecordIdFromHref('show#record=1', o), null);
    assert.equal(core.extractRecordIdFromHref('/k/5/edit#record=1', o), null);
  });
  it('resolveNavigationUrl は標準リンク優先', () => {
    const base = { origin: ORIGIN, appId: 5, recordId: '9', guestSpaceId: null };
    assert.equal(
      core.resolveNavigationUrl(Object.assign({ standardHref: '/k/5/show#record=12&x=1' }, base)),
      ORIGIN + '/k/5/show#record=12&x=1');
    assert.equal(
      core.resolveNavigationUrl(Object.assign({ standardHref: 'https://evil.example.com/k/5/show#record=12' }, base)),
      ORIGIN + '/k/5/show#record=9');
    assert.equal(core.resolveNavigationUrl({ origin: ORIGIN, appId: 5 }), null);
  });
});

describe('manifest', () => {
  const root = path.join(__dirname, '..', 'plugin');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  it('mobile キーが無い', () => {
    assert.equal('mobile' in manifest, false);
  });
  it('参照ファイルがすべて存在する', () => {
    const refs = [].concat(manifest.desktop.js, manifest.config.js, [manifest.config.html, manifest.icon]);
    refs.forEach((r) => assert.ok(fs.existsSync(path.join(root, r)), r));
  });
  it('name.en は 1〜64 文字', () => {
    assert.ok(manifest.name.en.length >= 1 && manifest.name.en.length <= 64);
    assert.equal(manifest.type, 'APP');
  });
  it('icon は PNG', () => {
    const b = fs.readFileSync(path.join(root, manifest.icon));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
  it('plugin 配下に innerHTML 系を使っていない', () => {
    ['js/core.js', 'js/kintone-api.js', 'js/desktop.js', 'js/config.js', 'html/config.html'].forEach((f) => {
      const s = fs.readFileSync(path.join(root, f), 'utf8');
      assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML/);
    });
  });
});
