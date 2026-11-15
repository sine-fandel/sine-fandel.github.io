/* Bilingual (English / 简体中文) support for the homepage.
 *
 * Markup conventions:
 *   data-i18n="key"                -> innerHTML is replaced from the dictionary
 *   data-i18n-placeholder="key"    -> placeholder attribute is replaced
 *   data-lang="en" / "zh"         -> whole blocks, toggled by CSS (see site-extras.css)
 *   data-lang-set="en" / "zh"     -> language switch buttons
 *   ?lang=zh                      -> shareable / bookmarkable language override
 *
 * The early inline snippet in _includes/head/custom.html sets the html class
 * before first paint so there is no flash of the wrong language.
 */
(function () {
  'use strict';

  var STORE_KEY = 'site-lang';
  var DICT = {
    en: {
      site_title: "Zhengxin Fang's Homepage",
      nav_home: 'Homepage',
      label_website: 'Website',
      label_email: 'Email',
      label_scholar: 'Google Scholar',
      label_github: 'GitHub',
      label_language: 'Language',
      heading_about: '&#128104;&zwj;&#128187; About Me',
      heading_experience: '&#128197; Experience',
      heading_publications: '&#128221; Publications',
      pub_loading: 'Loading publications from Google Scholar&hellip;',
      pub_error: 'Live data is unavailable right now, showing the last saved snapshot.',
      pub_snapshot_note: 'Showing the committed snapshot; the daily sync takes over automatically once it runs.',
      pub_search: 'Search title, author or venue',
      pub_filter_all: 'All',
      pub_filter_journal: 'Journals',
      pub_filter_conference: 'Conferences',
      pub_filter_preprint: 'Preprints',
      pub_filter_other: 'Other',
      pub_filter_label: 'Filter:',
      pub_no_results: 'No publications match your search.',
      pub_stat_citations: 'Citations',
      pub_stat_hindex: 'h-index',
      pub_stat_i10: 'i10-index',
      pub_stat_papers: 'Papers',
      pub_cited_by: 'cited by',
      pub_synced: 'Automatically synced from Google Scholar',
      pub_updated: 'Last synced',
      pub_source: 'data source',
      pub_view_all: 'View the full list on Google Scholar',
      pub_doi: 'DOI',
      pub_arxiv: 'arXiv',
      pub_scholar: 'Scholar',
      pub_count: '{n} papers',
      pub_type_journal: 'Journal',
      pub_type_conference: 'Conference',
      pub_type_preprint: 'Preprint',
      pub_type_other: 'Other'
    },
    zh: {
      site_title: '方正心 · 个人主页',
      nav_home: '首页',
      label_website: '个人网站',
      label_email: '邮箱',
      label_scholar: '谷歌学术',
      label_github: 'GitHub',
      label_language: '语言',
      heading_about: '&#128104;&zwj;&#128187; 关于我',
      heading_experience: '&#128197; 经历',
      heading_publications: '&#128221; 论文发表',
      pub_loading: '正在从谷歌学术同步论文&hellip;',
      pub_error: '暂时无法获取实时数据，当前显示最近一次保存的快照。',
      pub_snapshot_note: '当前显示仓库内保存的快照；每日同步任务运行后将自动切换为实时数据。',
      pub_search: '搜索标题、作者或期刊 / 会议',
      pub_filter_all: '全部',
      pub_filter_journal: '期刊',
      pub_filter_conference: '会议',
      pub_filter_preprint: '预印本',
      pub_filter_other: '其他',
      pub_filter_label: '筛选：',
      pub_no_results: '没有匹配的论文。',
      pub_stat_citations: '总引用',
      pub_stat_hindex: 'h 指数',
      pub_stat_i10: 'i10 指数',
      pub_stat_papers: '论文数',
      pub_cited_by: '引用',
      pub_synced: '数据自动同步自谷歌学术主页',
      pub_updated: '最近同步',
      pub_source: '数据源',
      pub_view_all: '在谷歌学术查看完整列表',
      pub_doi: 'DOI',
      pub_arxiv: 'arXiv',
      pub_scholar: '谷歌学术',
      pub_count: '{n} 篇论文',
      pub_type_journal: '期刊',
      pub_type_conference: '会议',
      pub_type_preprint: '预印本',
      pub_type_other: '其他'
    }
  };

  function isLang(value) {
    return value === 'en' || value === 'zh';
  }

  function storedLang() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function saveLang(lang) {
    try { window.localStorage.setItem(STORE_KEY, lang); } catch (e) { /* private mode */ }
  }

  function urlLang() {
    try { return new URLSearchParams(window.location.search).get('lang'); }
    catch (e) { return null; }
  }

  function detectLang() {
    var fromUrl = urlLang();
    if (isLang(fromUrl)) return fromUrl;
    var saved = storedLang();
    if (isLang(saved)) return saved;
    return /^zh\b/i.test(window.navigator.language || '') ? 'zh' : 'en';
  }

  function t(key, vars) {
    var lang = window.SiteI18n ? window.SiteI18n.getLang() : 'en';
    var value = (DICT[lang] && DICT[lang][key]) || (DICT.en[key]) || key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = value.split('{' + name + '}').join(vars[name]);
      });
    }
    return value;
  }

  function apply(lang) {
    lang = isLang(lang) ? lang : 'en';
    var root = document.documentElement;
    root.classList.remove('lang-en', 'lang-zh');
    root.classList.add('lang-' + lang);
    root.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');

    var nodes = document.querySelectorAll('[data-i18n]');
    Array.prototype.forEach.call(nodes, function (node) {
      var value = t(node.getAttribute('data-i18n'));
      if (value !== null && value !== undefined) node.innerHTML = value;
    });

    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    Array.prototype.forEach.call(placeholders, function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });

    var buttons = document.querySelectorAll('[data-lang-set]');
    Array.prototype.forEach.call(buttons, function (button) {
      var active = button.getAttribute('data-lang-set') === lang;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    document.title = t('site_title');
    document.dispatchEvent(new CustomEvent('site:langchange', { detail: { lang: lang } }));
  }

  var api = {
    t: t,
    getLang: function () {
      return document.documentElement.classList.contains('lang-zh') ? 'zh' : 'en';
    },
    setLang: function (lang) {
      if (!isLang(lang)) return;
      saveLang(lang);
      apply(lang);
      // Keep the URL shareable without reloading or losing the current anchor.
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.history.replaceState(null, '', url.toString());
      } catch (e) { /* older browsers */ }
    },
    refresh: function () { apply(api.getLang()); },
    detectLang: detectLang
  };

  window.SiteI18n = api;

  function init() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-lang-set]') : null;
      if (!button) return;
      event.preventDefault();
      api.setLang(button.getAttribute('data-lang-set'));
    });
    apply(detectLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
