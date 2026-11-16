(function (root) {
  'use strict';

  var CONFIG_KEY = 'config';
  var CONFIG_VERSION = 1;
  var KINDS = ['link', 'lookup', 'file', 'entitySelect', 'userMeta', 'richText', 'table'];
  var PRIORITY = { LINK: 'link', DETAIL: 'detail' };

  function defaultConfig() {
    var priorities = {};
    KINDS.forEach(function (k) {
      priorities[k] = PRIORITY.LINK;
    });
    return {
      version: CONFIG_VERSION,
      target: { mode: 'all', organizations: [], groups: [], includeChildOrgs: false },
      views: { mode: 'all', viewIds: [] },
      range: { mode: 'row', fieldCodes: [] },
      priorities: priorities,
      lookupFieldCodes: [],
      fieldOverrides: {}
    };
  }

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function strArray(v, coerce) {
    if (!Array.isArray(v)) return [];
    var out = [];
    v.forEach(function (x) {
      var s = null;
      if (typeof x === 'string') s = x;
      else if (coerce && typeof x === 'number' && isFinite(x)) s = String(x);
      if (s !== null && s !== '' && out.indexOf(s) === -1) out.push(s);
    });
    return out;
  }

  function enumOf(v, allowed, fallback) {
    return allowed.indexOf(v) !== -1 ? v : fallback;
  }

  function normalizeConfig(obj) {
    var d = defaultConfig();
    if (!isObj(obj)) return d;
    var t = isObj(obj.target) ? obj.target : {};
    var v = isObj(obj.views) ? obj.views : {};
    var r = isObj(obj.range) ? obj.range : {};
    var p = isObj(obj.priorities) ? obj.priorities : {};
    var priorities = {};
    KINDS.forEach(function (k) {
      priorities[k] = enumOf(p[k], [PRIORITY.LINK, PRIORITY.DETAIL], PRIORITY.LINK);
    });
    return {
      version: CONFIG_VERSION,
      target: {
        mode: enumOf(t.mode, ['all', 'specified'], 'all'),
        organizations: strArray(t.organizations),
        groups: strArray(t.groups),
        includeChildOrgs: t.includeChildOrgs === true
      },
      views: {
        mode: enumOf(v.mode, ['all', 'specified'], 'all'),
        viewIds: strArray(v.viewIds, true)
      },
      range: {
        mode: enumOf(r.mode, ['row', 'fields'], 'row'),
        fieldCodes: strArray(r.fieldCodes)
      },
      priorities: priorities,
      lookupFieldCodes: strArray(obj.lookupFieldCodes),
      fieldOverrides: {}
    };
  }

  function serializeConfig(config) {
    var o = {};
    o[CONFIG_KEY] = JSON.stringify(normalizeConfig(config));
    return o;
  }

  function parseConfig(raw) {
    try {
      if (!isObj(raw) || typeof raw[CONFIG_KEY] !== 'string') return defaultConfig();
      return normalizeConfig(JSON.parse(raw[CONFIG_KEY]));
    } catch (e) {
      return defaultConfig();
    }
  }

  function kindFromField(fieldType, fieldCode, lookupFieldCodes) {
    if (Array.isArray(lookupFieldCodes) && lookupFieldCodes.indexOf(fieldCode) !== -1) return 'lookup';
    switch (fieldType) {
      case 'LINK': return 'link';
      case 'FILE': return 'file';
      case 'USER_SELECT':
      case 'ORGANIZATION_SELECT':
      case 'GROUP_SELECT': return 'entitySelect';
      case 'CREATOR':
      case 'MODIFIER':
      case 'STATUS_ASSIGNEE': return 'userMeta';
      case 'RICH_TEXT': return 'richText';
      case 'SUBTABLE': return 'table';
      default: return null;
    }
  }

  function isViewInScope(config, event) {
    if (!event || event.viewType !== 'list') return false;
    if (config.views.mode === 'specified') {
      return config.views.viewIds.indexOf(String(event.viewId)) !== -1;
    }
    return true;
  }

  function isFieldInRange(config, fieldCode) {
    if (config.range.mode === 'row') return true;
    if (fieldCode === null || fieldCode === undefined) return false;
    return config.range.fieldCodes.indexOf(fieldCode) !== -1;
  }

  function decideClick(info, config) {
    var newTab = !!(info.ctrlKey || info.metaKey || info.button === 1);
    function none(reason) {
      return { action: 'none', newTab: newTab, reason: reason };
    }
    if (info.button === 2) return none('right-click');
    if (info.shiftKey) return none('shift'); // ブラウザ標準（新しいウィンドウ）に任せる
    if (info.inExcludedArea) return none('excluded-area');
    if (info.isInlineEditing) return none('inline-editing');
    if (info.hasSelection) return none('selection');
    if (!info.inMappedCell && info.kind !== 'table') return none('outside-target-cell');
    if (!isFieldInRange(config, info.fieldCode === undefined ? null : info.fieldCode)) return none('out-of-range');
    if (info.kind && config.priorities[info.kind] === PRIORITY.LINK && info.onInteractive) {
      return none('link-priority');
    }
    return { action: 'navigate', newTab: newTab, reason: 'navigate' };
  }

  function collectAncestorCodes(ownOrgCodes, parentMap) {
    var result = [];
    var map = isObj(parentMap) ? parentMap : {};
    (ownOrgCodes || []).forEach(function (own) {
      var cur = own;
      var depth = 0;
      var seen = {};
      while (typeof cur === 'string' && cur !== '' && !seen[cur] && depth < 100) {
        seen[cur] = true;
        if (result.indexOf(cur) === -1) result.push(cur);
        cur = Object.prototype.hasOwnProperty.call(map, cur) ? map[cur] : null;
        depth++;
      }
    });
    return result;
  }

  function isTargetUser(config, affiliation, parentMap) {
    if (config.target.mode === 'all') return true;
    if (!affiliation) return false;
    var orgCodes = affiliation.orgCodes || [];
    var groupCodes = affiliation.groupCodes || [];
    if (config.target.includeChildOrgs) {
      orgCodes = collectAncestorCodes(orgCodes, parentMap || affiliation.orgParentMap || {});
    }
    var orgHit = orgCodes.some(function (c) { return config.target.organizations.indexOf(c) !== -1; });
    if (orgHit) return true;
    return groupCodes.some(function (c) { return config.target.groups.indexOf(c) !== -1; });
  }

  async function fetchAllPages(fetchPage, opts) {
    var size = (opts && opts.size) || 100;
    var max = (opts && opts.max) || 10000;
    var all = [];
    var offset = 0;
    while (offset < max) {
      var page = await fetchPage(offset, size);
      if (!Array.isArray(page)) break;
      all = all.concat(page);
      if (page.length < size) break;
      offset += size;
    }
    return all.length > max ? all.slice(0, max) : all;
  }

  function isPosInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0;
    return typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0;
  }

  function buildRecordUrl(p) {
    if (!p || !isPosInt(p.appId) || !isPosInt(p.recordId)) return null;
    var origin = p.origin;
    if (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) return null;
    var guest = '';
    if (p.guestSpaceId !== null && p.guestSpaceId !== undefined && p.guestSpaceId !== '') {
      if (!isPosInt(p.guestSpaceId)) return null;
      guest = 'guest/' + String(p.guestSpaceId) + '/';
    }
    return origin + '/k/' + guest + String(p.appId) + '/show#record=' + String(p.recordId);
  }

  function parseGuestSpaceId(pathname) {
    var m = /^\/k\/guest\/(\d+)\//.exec(pathname || '');
    return m ? m[1] : null;
  }

  function extractRecordIdFromHref(href, opts) {
    try {
      if (typeof href !== 'string' || !opts || !isPosInt(opts.appId)) return null;
      var u = new URL(href, opts.origin);
      if (u.origin !== opts.origin) return null;
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      var re = new RegExp('^/k/(guest/\\d+/)?' + String(opts.appId) + '/show$');
      if (!re.test(u.pathname)) return null;
      var hash = u.hash.replace(/^#/, '');
      var params = hash.split('&');
      for (var i = 0; i < params.length; i++) {
        var kv = params[i].split('=');
        if (kv[0] === 'record') {
          return /^\d+$/.test(kv[1] || '') ? kv[1] : null;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function isSafeRecordUrl(url, opts) {
    return extractRecordIdFromHref(url, opts) !== null;
  }

  function resolveNavigationUrl(p) {
    if (!p) return null;
    if (p.standardHref && isSafeRecordUrl(p.standardHref, { origin: p.origin, appId: p.appId })) {
      return new URL(p.standardHref, p.origin).href;
    }
    return buildRecordUrl({
      origin: p.origin,
      appId: p.appId,
      recordId: p.recordId,
      guestSpaceId: p.guestSpaceId
    });
  }

  var api = {
    CONFIG_KEY: CONFIG_KEY,
    CONFIG_VERSION: CONFIG_VERSION,
    KINDS: KINDS,
    PRIORITY: PRIORITY,
    DEFAULT_CONFIG: defaultConfig,
    normalizeConfig: normalizeConfig,
    serializeConfig: serializeConfig,
    parseConfig: parseConfig,
    kindFromField: kindFromField,
    isViewInScope: isViewInScope,
    isFieldInRange: isFieldInRange,
    decideClick: decideClick,
    isTargetUser: isTargetUser,
    collectAncestorCodes: collectAncestorCodes,
    fetchAllPages: fetchAllPages,
    buildRecordUrl: buildRecordUrl,
    parseGuestSpaceId: parseGuestSpaceId,
    extractRecordIdFromHref: extractRecordIdFromHref,
    isSafeRecordUrl: isSafeRecordUrl,
    resolveNavigationUrl: resolveNavigationUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KintoneRowClick = root.KintoneRowClick || {};
    root.KintoneRowClick.core = api;
  }
})(typeof window !== 'undefined' ? window : null);
