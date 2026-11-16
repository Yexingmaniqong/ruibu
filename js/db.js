/* =========================================================
 * db.js — 极简 IndexedDB 封装
 * store "kv"      : 存整个 state（结构小，写入快）
 * store "images"  : 存图片 dataURL（按 id 分条，避免整块序列化）
 * ========================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'mindnote-db';
  var DB_VER = 1;
  var _dbp = null;

  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('浏览器不支持 IndexedDB'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return _dbp;
  }

  function tx(store, mode) {
    return openDB().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var DB = {
    get: function (store, key) {
      return tx(store, 'readonly').then(function (s) {
        return reqToPromise(s.get(key));
      });
    },
    set: function (store, key, val) {
      return tx(store, 'readwrite').then(function (s) {
        return reqToPromise(s.put(val, key));
      });
    },
    del: function (store, key) {
      return tx(store, 'readwrite').then(function (s) {
        return reqToPromise(s.delete(key));
      });
    },
    keys: function (store) {
      return tx(store, 'readonly').then(function (s) {
        return reqToPromise(s.getAllKeys());
      });
    },
    clear: function (store) {
      return tx(store, 'readwrite').then(function (s) {
        return reqToPromise(s.clear());
      });
    },
    estimate: function () {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
      return navigator.storage.estimate().catch(function () { return null; });
    }
  };

  global.DB = DB;
})(window);
