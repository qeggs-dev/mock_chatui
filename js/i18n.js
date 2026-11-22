/* i18n.js — tiny dependency-free bilingual (zh / en) runtime.
 *
 * Usage in JS:
 *   CM.i18n.tr('中文', 'English', { n: 3 })
 *   CM.i18n.set('en')
 *   CM.i18n.onChange(function (lang) { ... })
 *
 * Static HTML uses paired attributes, only on leaf text nodes / attributes:
 *   <span data-zh="导出图片" data-en="Export image">导出图片</span>
 *   <button data-zh-title="撤销" data-en-title="Undo" ...>
 *   <input data-zh-placeholder="输入消息…" data-en-placeholder="Type a message…">
 *   <svg data-zh-aria="聊天记录预览" data-en-aria="Chat preview">
 *
 * Language lookup order: localStorage (mock_chatui:lang, falling back to the
 * legacy chatlog-mock:lang) > navigator.language (zh* -> zh, everything else
 * -> en). An English browser starts in English.
 */
(function () {
  'use strict';

  const CM = (window.CM = window.CM || {});
  const KEY = 'mock_chatui:lang';
  const LEGACY_KEY = 'chatlog-mock:lang';
  const LANGS = ['zh', 'en'];
  const listeners = [];

  function normalize(value) {
    return LANGS.indexOf(value) >= 0 ? value : '';
  }

  function stored() {
    try {
      const current = normalize(localStorage.getItem(KEY));
      if (current) return current;
      const legacy = normalize(localStorage.getItem(LEGACY_KEY));
      if (legacy) {
        try {
          localStorage.setItem(KEY, legacy);
        } catch (e) {}
        return legacy;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function detect() {
    const saved = stored();
    if (saved) return saved;
    let nav = '';
    try {
      nav = String(navigator.language || navigator.userLanguage || '').toLowerCase();
    } catch (e) {}
    if (nav.indexOf('zh') === 0) return 'zh';
    if (nav) return 'en';
    return 'zh';
  }

  let lang = detect();

  function tr(zh, en, vars) {
    let text = lang === 'en' ? (en == null ? zh : en) : zh == null ? en : zh;
    if (text == null) text = '';
    if (vars) {
      text = String(text).replace(/\{(\w+)\}/g, function (match, key) {
        return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
      });
    }
    return String(text);
  }

  /** Apply data-zh / data-en pairs to static markup. Safe to call repeatedly. */
  function apply(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;

    // Leaf text only: containers that own child elements are left alone, so
    // icons / nested markup inside a translated label are never destroyed.
    scope.querySelectorAll('[data-zh]').forEach(function (el) {
      if (el.childElementCount > 0) return;
      const value = el.getAttribute('data-' + lang);
      if (value != null) el.textContent = value;
    });

    // Paired attributes: data-zh-title, data-zh-aria, data-zh-placeholder, ...
    scope.querySelectorAll('*').forEach(function (el) {
      const attrs = el.attributes;
      if (!attrs || !attrs.length) return;
      for (let i = 0; i < attrs.length; i++) {
        const name = attrs[i].name;
        if (name.indexOf('data-zh-') !== 0) continue;
        const suffix = name.slice('data-zh-'.length);
        const target = suffix === 'aria' ? 'aria-label' : suffix;
        const value = el.getAttribute('data-' + lang + '-' + suffix);
        if (value != null) el.setAttribute(target, value);
      }
    });

    // Highlight the active language button everywhere (shell + settings drawer).
    const buttons = document.querySelectorAll('[data-lang]');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-lang') === lang);
    }

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }

  function applyActive() {
    const buttons = document.querySelectorAll('[data-lang]');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-lang') === lang);
    }
  }

  function persist(next) {
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {}
  }

  function set(next) {
    next = normalize(next);
    if (!next) return lang;
    if (next === lang) {
      applyActive();
      return lang;
    }
    lang = next;
    persist(lang);
    apply();
    listeners.slice().forEach(function (fn) {
      try {
        fn(lang);
      } catch (e) {
        if (window.console && console.error) console.error('[i18n] listener failed', e);
      }
    });
    // Listeners may have re-rendered dynamic UI (e.g. the settings drawer):
    // refresh active states for the new buttons without re-applying static
    // text over values those listeners just rendered.
    applyActive();
    return lang;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  CM.i18n = {
    KEY: KEY,
    get lang() {
      return lang;
    },
    get locale() {
      return lang === 'zh' ? 'zh-CN' : 'en';
    },
    isZh: function () {
      return lang === 'zh';
    },
    get: function () {
      return lang;
    },
    set: set,
    tr: tr,
    apply: apply,
    onChange: onChange
  };

  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  if (document.readyState === 'loading') {
    // Scripts sit at the end of <body>, so the static markup above is already
    // available: apply right away to avoid a flash of the other language.
    if (document.body) apply();
    document.addEventListener('DOMContentLoaded', function () {
      apply();
    });
  } else {
    apply();
  }
})();
