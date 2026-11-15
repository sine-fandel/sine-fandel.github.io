/* Renders citation metrics + the publication list from the Scholar snapshot.
 *
 * Data priority (all fetched client-side, no Jekyll rebuild needed):
 *   1. raw.githubusercontent.com  <repo>/google-scholar-stats/gs_data.json  (freshest)
 *   2. cdn.jsdelivr.net/gh        <repo>@google-scholar-stats/gs_data.json
 *   3. /assets/data/scholar.json  (committed snapshot, always available)
 *
 * The GitHub Action "Sync Google Scholar Data" refreshes #1/#2 daily, so the
 * homepage stays in sync with the Scholar profile.
 */
(function () {
  'use strict';

  var cfg = window.SCHOLAR_CONFIG || {};
  var repo = cfg.repository || 'sine-fandel/sine-fandel.github.io';
  var branch = cfg.statsBranch || 'google-scholar-stats';
  var localUrl = cfg.localSnapshot || '/assets/data/scholar.json';
  var extrasUrl = cfg.extrasUrl || '/assets/data/publication-links.json';
  var scholarProfileUrl = cfg.scholarUrl ||
    'https://scholar.google.com/citations?user=Y3LoyksAAAAJ&hl=en';

  var t = function (key, vars) {
    return window.SiteI18n ? window.SiteI18n.t(key, vars) : key;
  };
  var lang = function () {
    return window.SiteI18n ? window.SiteI18n.getLang() : 'en';
  };

  var state = { data: null, extras: {}, filter: 'all', query: '', origin: 'snapshot' };
  var mount = document.getElementById('scholar-app');
  if (!mount) return;

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
      return response.json();
    });
  }

  function tryInOrder(urls, index) {
    if (index >= urls.length) return Promise.reject(new Error('all sources failed'));
    return fetchJson(urls[index]).catch(function () { return tryInOrder(urls, index + 1); });
  }

  function classify(pub) {
    if (pub.type) return pub.type;
    var text = ((pub.venue || '') + ' ' + (pub.title || '')).toLowerCase();
    if (/arxiv|preprint|biorxiv|ssrn/.test(text)) return 'preprint';
    if (/transactions|journal|expert systems with applications|computing surveys/.test(text)) return 'journal';
    if (/conference|symposium|workshop|australasian/.test(text)) return 'conference';
    return 'other';
  }

  function citationUrl(id) {
    return 'https://scholar.google.com/citations?view_op=view_citation&hl=en&user=' +
      encodeURIComponent(cfg.scholarId || 'Y3LoyksAAAAJ') +
      '&citation_for_view=' + encodeURIComponent(id);
  }

  function normalize(raw) {
    var source = raw || {};
    var pubs = [];
    if (Array.isArray(source.publications)) {
      pubs = source.publications.slice();
    } else if (source.publications && typeof source.publications === 'object') {
      // Legacy `scholarly` payload: publications is a map keyed by author_pub_id.
      pubs = Object.keys(source.publications).map(function (id) {
        var entry = source.publications[id] || {};
        var bib = entry.bib || {};
        return {
          id: id,
          title: bib.title,
          authors: bib.author,
          venue: bib.journal || bib.conference || bib.publisher || bib.institution || '',
          year: parseInt(bib.pub_year, 10) || 0,
          citations: parseInt(entry.num_citations, 10) || 0
        };
      });
    }

    pubs = pubs.filter(function (p) { return p && p.title; }).map(function (p) {
      var venue = String(p.venue || '').replace(/\s*,\s*\b(19|20)\d{2}\s*$/, '').trim();
      var arxiv = p.eprint_url || ((venue.match(/arXiv:\s*([0-9]{4}\.[0-9]{4,5})/i) || [])[1]
        ? 'https://arxiv.org/abs/' + venue.match(/arXiv:\s*([0-9]{4}\.[0-9]{4,5})/i)[1]
        : null);
      var id = String(p.id || '').trim();
      return {
        id: id,
        title: String(p.title || '').trim(),
        authors: String(p.authors || '').trim(),
        venue: venue,
        year: parseInt(p.year, 10) || 0,
        citations: parseInt(p.citations, 10) || 0,
        type: classify({ type: p.type, venue: venue, title: p.title }),
        eprint_url: arxiv,
        url: p.url || (id ? citationUrl(id) : scholarProfileUrl),
        search: (String(p.title || '') + ' ' + String(p.authors || '') + ' ' + venue + ' ' + (p.year || ''))
          .toLowerCase()
      };
    });
    pubs.sort(function (a, b) {
      return b.year - a.year || b.citations - a.citations || a.title.localeCompare(b.title);
    });

    var metrics = source.metrics || {};
    return {
      updated: source.updated || '',
      name: source.name || '',
      metrics: {
        citations: parseInt(metrics.citations !== undefined ? metrics.citations : source.citedby, 10) || 0,
        h_index: parseInt(metrics.h_index !== undefined ? metrics.h_index : source.hindex, 10) || 0,
        i10_index: parseInt(metrics.i10_index !== undefined ? metrics.i10_index : source.i10index, 10) || 0
      },
      publications: pubs
    };
  }

  function highlightAuthors(authors) {
    return esc(authors).replace(/\bZ\.?\s?Fang\b/g, '<strong class="pub-self">$&</strong>');
  }

  function niceDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return esc(String(value).slice(0, 10));
    return date.toISOString().slice(0, 10);
  }

  function statCard(value, label) {
    return '<div class="stat-card"><span class="stat-card__value">' + esc(value) +
      '</span><span class="stat-card__label">' + esc(label) + '</span></div>';
  }

  function typeLabel(type) {
    var key = 'pub_type_' + type;
    return t(key) === key ? t('pub_type_other') : t(key);
  }

  function linksFor(pub) {
    var extra = state.extras[pub.id] || {};
    var out = [];
    if (extra.doi) {
      out.push('<a class="pub-link" href="https://doi.org/' + esc(extra.doi) +
        '" target="_blank" rel="noopener">DOI</a>');
    }
    if (pub.eprint_url) {
      out.push('<a class="pub-link" href="' + esc(pub.eprint_url) +
        '" target="_blank" rel="noopener">' + esc(t('pub_arxiv')) + '</a>');
    }
    if (pub.url) {
      out.push('<a class="pub-link" href="' + esc(pub.url) +
        '" target="_blank" rel="noopener">' + esc(t('pub_scholar')) + '</a>');
    }
    (extra.badges || []).forEach(function (badge) {
      out.push('<span class="pub-badge">' + esc(badge) + '</span>');
    });
    return out.join('');
  }

  function publicationHtml(pub) {
    return '<article class="pub-item" data-type="' + esc(pub.type) +
      '" data-search="' + esc(pub.search) + '">' +
      '<div class="pub-item__title"><a href="' + esc(pub.url) +
      '" target="_blank" rel="noopener">' + esc(pub.title) + '</a></div>' +
      '<div class="pub-item__authors">' + highlightAuthors(pub.authors) + '</div>' +
      '<div class="pub-item__venue">' + esc(pub.venue) + '</div>' +
      '<div class="pub-item__meta">' +
      '<span class="pub-item__type pub-item__type--' + esc(pub.type) + '">' +
      esc(typeLabel(pub.type)) + '</span>' +
      '<span class="pub-item__citations">' + esc(pub.citations) + ' ' + esc(t('pub_cited_by')) + '</span>' +
      linksFor(pub) + '</div></article>';
  }

  function render() {
    var data = state.data;
    if (!data) return;
    var pubs = data.publications;
    var years = [];
    var byYear = {};
    pubs.forEach(function (pub) {
      var key = pub.year || 0;
      if (!byYear[key]) { byYear[key] = []; years.push(key); }
      byYear[key].push(pub);
    });
    years.sort(function (a, b) { return b - a; });

    var groups = years.map(function (year) {
      return '<section class="pub-year" data-year="' + year + '">' +
        '<h3 class="pub-year__heading">' + (year || '—') +
        '<span class="pub-year__count">' + byYear[year].length + '</span></h3>' +
        '<div class="pub-year__items">' + byYear[year].map(publicationHtml).join('') +
        '</div></section>';
    }).join('');

    var filters = ['all', 'journal', 'conference', 'preprint', 'other'].map(function (type) {
      return '<button type="button" class="pub-filter' + (state.filter === type ? ' is-active' : '') +
        '" data-filter="' + type + '">' + esc(t('pub_filter_' + type)) + '</button>';
    }).join('');

    var note = state.origin === 'snapshot'
      ? '<span class="pub-sync-note__fallback">' + esc(t('pub_snapshot_note')) + '</span>'
      : '';

    mount.innerHTML =
      '<div class="scholar-stats">' +
      statCard(data.metrics.citations, t('pub_stat_citations')) +
      statCard(data.metrics.h_index, t('pub_stat_hindex')) +
      statCard(data.metrics.i10_index, t('pub_stat_i10')) +
      statCard(pubs.length, t('pub_stat_papers')) +
      '</div>' +
      '<p class="pub-sync-note">' + esc(t('pub_synced')) +
      ' &middot; ' + esc(t('pub_updated')) + ': ' + niceDate(data.updated) +
      ' &middot; <a href="' + esc(scholarProfileUrl) + '" target="_blank" rel="noopener">' +
      esc(t('pub_source')) + ' &#8599;</a>' + note + '</p>' +
      '<div class="pub-toolbar">' +
      '<div class="pub-filters" role="group" aria-label="' + esc(t('pub_filter_label')) + '">' +
      filters + '</div>' +
      '<input class="pub-search" type="search" value="' + esc(state.query) +
      '" placeholder="' + esc(t('pub_search')) + '" aria-label="' + esc(t('pub_search')) + '">' +
      '<span class="pub-count"></span>' +
      '</div>' +
      '<div class="pub-list">' + groups + '</div>' +
      '<p class="pub-empty" hidden>' + esc(t('pub_no_results')) + '</p>' +
      '<p class="pub-footer"><a href="' + esc(scholarProfileUrl) +
      '" target="_blank" rel="noopener">' + esc(t('pub_view_all')) + ' &#8599;</a></p>';

    updateVisibility();
    bindControls();
  }

  function updateVisibility() {
    if (!state.data) return;
    var items = mount.querySelectorAll('.pub-item');
    var shown = 0;
    Array.prototype.forEach.call(items, function (item) {
      var typeOk = state.filter === 'all' || item.getAttribute('data-type') === state.filter;
      var queryOk = !state.query || (item.getAttribute('data-search') || '').indexOf(state.query) !== -1;
      var show = typeOk && queryOk;
      item.hidden = !show;
      if (show) shown++;
    });
    Array.prototype.forEach.call(mount.querySelectorAll('.pub-year'), function (group) {
      var any = group.querySelectorAll('.pub-item:not([hidden])').length > 0;
      group.hidden = !any;
    });
    var counter = mount.querySelector('.pub-count');
    if (counter) counter.textContent = t('pub_count', { n: shown });
    var empty = mount.querySelector('.pub-empty');
    if (empty) empty.hidden = shown !== 0;
  }

  function bindControls() {
    Array.prototype.forEach.call(mount.querySelectorAll('[data-filter]'), function (button) {
      button.addEventListener('click', function () {
        state.filter = button.getAttribute('data-filter');
        Array.prototype.forEach.call(mount.querySelectorAll('[data-filter]'), function (b) {
          b.classList.toggle('is-active', b === button);
        });
        updateVisibility();
      });
    });
    var search = mount.querySelector('.pub-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value.trim().toLowerCase();
        updateVisibility();
      });
    }
  }

  function updateLegacyHooks(data) {
    var total = document.getElementById('total_cit');
    if (total) total.textContent = data.metrics.citations;
    Array.prototype.forEach.call(document.getElementsByClassName('show_paper_citations'), function (el) {
      var wanted = el.getAttribute('data') || '';
      var found = data.publications.filter(function (p) {
        return p.id === wanted || p.id.split(':').slice(-1)[0] === wanted;
      })[0];
      if (found) el.textContent = '| Citations: ' + found.citations;
    });
  }

  function sources() {
    var stamp = '?_=' + Date.now();
    var raw = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/gs_data.json' + stamp;
    var cdn = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/gs_data.json' + stamp;
    return cfg.preferCdn ? [cdn, raw, localUrl] : [raw, cdn, localUrl];
  }

  function boot() {
    mount.innerHTML = '<p class="pub-loading">' + t('pub_loading') + '</p>';
    var urls = sources();
    tryInOrder(urls, 0).then(function (raw) {
      state.data = normalize(raw);
      // The committed snapshot is the last-resort source; flag it so the UI
      // can tell the visitor the live sync is not currently reachable.
      state.origin = raw && raw.fetch_strategy === 'snapshot' ? 'snapshot' : 'live';
      return fetchJson(extrasUrl).catch(function () { return {}; });
    }).then(function (extras) {
      state.extras = extras || {};
      render();
      updateLegacyHooks(state.data);
    }).catch(function (error) {
      mount.innerHTML = '<p class="pub-loading">' + esc(t('pub_error')) + '</p>';
      console.warn('[scholar] ', error);
    });

    document.addEventListener('site:langchange', function () {
      if (state.data) render();
      else mount.innerHTML = '<p class="pub-loading">' + t('pub_loading') + '</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
