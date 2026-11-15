# Zhengxin Fang — Academic Homepage

Personal homepage for **Zhengxin Fang (方正心)**, Assistant Researcher / Postdoctoral Researcher at the
[Shenzhen Institutes of Advanced Technology (SIAT)](https://www.siat.ac.cn/), Chinese Academy of Sciences.

Published at **https://sine-fandel.github.io/**

Built with Jekyll and hosted on GitHub Pages. Based on [AcadHomepage](https://github.com/RayeRen/acad-homepage.github.io),
which is itself influenced by Minimal Mistakes and academicpages.

## Key features

- **Publications auto-synced with Google Scholar** — the publication list and citation metrics are
  generated from the Scholar profile, not hand-edited. A GitHub Action refreshes the data daily.
- **Bilingual EN / 中文** — every section, navigation item, label and the publication UI switches
  language instantly; the choice is remembered and can be shared with `?lang=zh`.
- **Resilient by design** — the site ships with a committed Scholar snapshot, so the publication
  list still renders if Scholar, GitHub or the CDN is temporarily unavailable.
- Responsive layout, Font Awesome / Academicons icons, SEO metadata, Google Analytics support.

## How the Scholar sync works

```
Google Scholar profile  ──(GitHub Action, daily 08:00 UTC)──▶  google-scholar-stats/gs_data.json
                                                                  │
                                   raw.githubusercontent.com ────┤
                                   cdn.jsdelivr.net ──────────────┼──▶  homepage (client-side render)
                                   /assets/data/scholar.json ──────┘     (committed fallback snapshot)
```

1. `.github/workflows/google_scholar_crawler.yaml` runs on `page_build`, on a daily cron, or on
   manual `workflow_dispatch`.
2. `google_scholar_crawler/main.py` fetches the profile. It first parses the public profile HTML
   with `requests` + BeautifulSoup (one request, paginated, several regional Scholar hosts),
   then retries through Google's translate proxy (Google-side fetch, useful when datacenter IPs
   are blocked), and finally falls back to the `scholarly` package. If every strategy fails it
   writes **no** `gs_data.json`, so the last good data is never overwritten.
3. Valid results are pushed as `gs_data.json` + `gs_data_shieldsio.json` to the orphan branch
   `google-scholar-stats`. A blocked run does not fail the job: it preserves whatever is already
   on that branch and publishes `sync-status.json` plus a run-summary with the error log.

> **Note on Google Scholar rate limits.** Scholar blocks most cloud/datacenter IPs, including
> GitHub-hosted runners, with HTTP 403/429. The daily Action therefore usually records a blocked
> run and keeps the last good data. For a guaranteed fresh sync, run this from your own network:
>
> ```bash
> ./sync_scholar.sh          # crawls Scholar and force-pushes the data branch
> PYTHON=/path/to/python ./sync_scholar.sh   # optional interpreter override
> ```
>
> Alternatively set a repo secret `SCHOLAR_HTTP_PROXY` to an HTTP(S) proxy that can reach Scholar,
> and the scheduled Action will use it. `GOOGLE_SCHOLAR_ID` is optional (defaults to `scholar_id`
> in `_config.yml`).
4. `assets/js/scholar-publications.js` reads that JSON at runtime (raw GitHub → jsDelivr → local
   snapshot) and renders the metric cards and year-grouped publication list into `#scholar-app`.
   No Jekyll rebuild is needed when Scholar changes.

The Scholar id lives in `_config.yml` (`scholar_id`). Optionally set the repo secret
`GOOGLE_SCHOLAR_ID` (`Settings → Secrets and variables → Actions`); if it is absent the workflow
uses the configured id. To force a refresh, run the **Sync Google Scholar Data** workflow manually
from the Actions tab.

### Files to edit for publications

| File | Purpose |
| --- | --- |
| `assets/data/scholar.json` | Committed fallback snapshot (normally maintained by the crawler). |
| `assets/data/publication-links.json` | Hand-curated extras keyed by Scholar citation id: `doi` and `badges` (e.g. `CCF A`). The crawler never touches this file. |
| `google_scholar_crawler/main.py` | Fetch / normalize logic. |
| `.github/workflows/google_scholar_crawler.yaml` | Sync schedule. |

Add a `show_paper_citations` span with the Scholar paper id to display an individual citation count
anywhere on the page (legacy feature, still supported):

```html
<span class="show_paper_citations" data="Y3LoyksAAAAJ:d1gkVwhDpl0C"></span>
```

## Language switch

- `assets/js/i18n.js` holds the EN/ZH dictionary and the switch logic.
- `<html>` gets `lang-en` / `lang-zh` before first paint (inline snippet in
  `_includes/head/custom.html`), so there is no flash of the wrong language.
- `data-i18n="key"` swaps an element's text; `data-lang="en"` / `data-lang="zh"` wraps whole blocks;
  `?lang=zh` forces a language; the last choice is stored in `localStorage`.
- Navigation labels come from `_data/navigation.yml` (`title` / `title_zh`).
- Sidebar bio / name / location come from `author.*` in `_config.yml` (`bio_en`, `bio_zh`,
  `name_zh`, `location_zh`).

## Edit content

- `_pages/about.md` — homepage content (bilingual sections, appointments, education).
- `_config.yml` — site title, author details, links, Scholar id, CDN preference.
- `_data/navigation.yml` — top navigation.
- `assets/css/site-extras.css` — all new styling for the language switch, metric cards and
  publication list.

## Run locally

```bash
bundle install
bundle exec jekyll serve   # or: bash run_server.sh
# open http://127.0.0.1:4000
```

The publication list works locally too: the remote data branch is optional, and the committed
snapshot in `assets/data/scholar.json` is used as a fallback.

## Acknowledgements

- AcadHomepage incorporates Font Awesome (SIL OFL 1.1 / MIT).
- Influenced by [mmistakes/minimal-mistakes](https://github.com/mmistakes/minimal-mistakes) and
  [academicpages/academicpages.github.io](https://github.com/academicpages/academicpages.github.io)
  (both MIT licensed).
