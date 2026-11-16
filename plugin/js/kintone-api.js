(function (PLUGIN_ID_UNUSED) {
  'use strict';

  var ns = (window.KintoneRowClick = window.KintoneRowClick || {});
  var core = ns.core;
  var CACHE_TTL_MS = 10 * 60 * 1000;
  var memo = {};

  function pluginId() {
    try {
      return kintone.$PLUGIN_ID || 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }

  // User API / 通常 API のパス組み立てはここに集約する。
  function userApiPath(name) {
    return '/v1/' + name + '.json';
  }

  // まず /v1/... をそのまま渡し、失敗したら kintone.api.url 経由を1回だけ試す。
  async function callApi(path, method, params) {
    try {
      return await kintone.api(path, method, params);
    } catch (e1) {
      return await kintone.api(kintone.api.url(path, true), method, params);
    }
  }

  async function safe(fn) {
    try {
      return await fn();
    } catch (e) {
      return null;
    }
  }

  function cacheKey(userCode) {
    return 'krc:' + pluginId() + ':' + userCode;
  }

  function readCache(key) {
    var now = Date.now();
    var m = memo[key];
    if (m && now - m.savedAt < CACHE_TTL_MS) return m.data;
    try {
      var raw = window.sessionStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.savedAt === 'number' && now - parsed.savedAt < CACHE_TTL_MS) {
          memo[key] = parsed;
          return parsed.data;
        }
      }
    } catch (e) { /* sessionStorage 不可 */ }
    return null;
  }

  function writeCache(key, data) {
    var entry = { savedAt: Date.now(), data: data };
    memo[key] = entry;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(entry));
    } catch (e) { /* メモのみ */ }
  }

  async function getMyAffiliation() {
    return safe(async function () {
      var user = kintone.getLoginUser();
      if (!user || !user.code) return null;
      var key = cacheKey(user.code);
      var cached = readCache(key);
      if (cached) return cached;
      var res = await Promise.all([
        callApi(userApiPath('user/organizations'), 'GET', { code: user.code }),
        callApi(userApiPath('user/groups'), 'GET', { code: user.code })
      ]);
      var orgCodes = [];
      var orgParentMap = {};
      ((res[0] && res[0].organizationTitles) || []).forEach(function (t) {
        var o = t && t.organization;
        if (o && typeof o.code === 'string') {
          if (orgCodes.indexOf(o.code) === -1) orgCodes.push(o.code);
          if (typeof o.parentCode === 'string' && o.parentCode) orgParentMap[o.code] = o.parentCode;
        }
      });
      var groupCodes = [];
      ((res[1] && res[1].groups) || []).forEach(function (g) {
        if (g && typeof g.code === 'string' && groupCodes.indexOf(g.code) === -1) groupCodes.push(g.code);
      });
      var data = { orgCodes: orgCodes, orgParentMap: orgParentMap, groupCodes: groupCodes };
      writeCache(key, data);
      return data;
    });
  }

  async function getOrganizationParentMap() {
    return safe(async function () {
      var key = 'krc:' + pluginId() + ':orgmap';
      var cached = readCache(key);
      if (cached) return cached;
      var orgs = await core.fetchAllPages(async function (offset, size) {
        var r = await callApi(userApiPath('organizations'), 'GET', { offset: offset, size: size });
        return (r && r.organizations) || [];
      }, { size: 100 });
      var map = {};
      orgs.forEach(function (o) {
        if (o && typeof o.code === 'string' && typeof o.parentCode === 'string' && o.parentCode) {
          map[o.code] = o.parentCode;
        }
      });
      writeCache(key, map);
      return map;
    });
  }

  async function previewThenLive(name, appId) {
    return safe(async function () {
      try {
        return await kintone.api(kintone.api.url('/k/v1/preview/app/' + name + '.json', true), 'GET', { app: appId });
      } catch (e) {
        return await kintone.api(kintone.api.url('/k/v1/app/' + name + '.json', true), 'GET', { app: appId });
      }
    });
  }

  function getViews(appId) {
    return previewThenLive('views', appId);
  }

  function getFields(appId) {
    return previewThenLive('form/fields', appId);
  }

  async function getAllOrganizations() {
    return safe(function () {
      return core.fetchAllPages(async function (offset, size) {
        var r = await callApi(userApiPath('organizations'), 'GET', { offset: offset, size: size });
        return (r && r.organizations) || [];
      }, { size: 100 });
    });
  }

  async function getAllGroups() {
    return safe(function () {
      return core.fetchAllPages(async function (offset, size) {
        var r = await callApi(userApiPath('groups'), 'GET', { offset: offset, size: size });
        return (r && r.groups) || [];
      }, { size: 100 });
    });
  }

  ns.api = {
    userApiPath: userApiPath,
    getMyAffiliation: getMyAffiliation,
    getOrganizationParentMap: getOrganizationParentMap,
    getViews: getViews,
    getFields: getFields,
    getAllOrganizations: getAllOrganizations,
    getAllGroups: getAllGroups
  };
})();
