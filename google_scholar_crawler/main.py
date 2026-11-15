#!/usr/bin/env python3
"""Build a normalized snapshot of a Google Scholar profile.

Outputs (written to ./results/):
  * gs_data.json            - metrics + the full publication list, consumed by
                              assets/js/scholar-publications.js
  * gs_data_shieldsio.json  - shields.io badge payload (citations)

Two independent strategies are attempted, because Scholar rate-limits some IPs:
  1. ``scholarly`` (rich metadata)
  2. a direct scrape of the public profile HTML (requests + BeautifulSoup)

If neither returns a usable profile, NOTHING is written and the process exits
with status 1. The GitHub Actions job then stops before publishing, so an
empty/broken snapshot can never overwrite the last good data.

Environment:
  GOOGLE_SCHOLAR_ID  - Scholar user id (defaults to this site's owner)
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SCHOLAR_ID = os.environ.get("GOOGLE_SCHOLAR_ID", "Y3LoyksAAAAJ").strip() or "Y3LoyksAAAAJ"
SCHOLAR_URL = f"https://scholar.google.com/citations?user={SCHOLAR_ID}&hl=en"
# Try several regional Scholar hosts: rate limiting is often host-specific.
SCHOLAR_HOSTS = (
    "https://scholar.google.com/citations",
    "https://scholar.google.co.uk/citations",
    "https://scholar.google.com.au/citations",
    "https://scholar.google.de/citations",
)
# Optional escape hatch for networks where Scholar only works through a proxy.
PROXY = os.environ.get("SCHOLAR_HTTP_PROXY", "").strip()
PROXIES = {"http": PROXY, "https": PROXY} if PROXY else None
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
RESULTS = Path(__file__).resolve().parent / "results"

JOURNAL_HINTS = (
    "transactions on",
    "ieee transactions",
    "journal",
    "expert systems with applications",
    "acm computing surveys",
    "proceedings of the ieee",
)
CONFERENCE_HINTS = (
    "conference",
    "symposium",
    "workshop",
    "australasian joint conference",
    "australasian conference",
    "evoapplications",
)
PREPRINT_HINTS = ("arxiv", "preprint", "biorxiv", "ssrn", "tech report")


def _int(value) -> int:
    """Best-effort int parsing for Scholar's table cells."""
    if isinstance(value, int):
        return value
    match = re.search(r"\d[\d,]*", str(value or ""))
    return int(match.group(0).replace(",", "")) if match else 0


def _citation_url(cid: str) -> str:
    """Scholar citation ids are either ``USER_ID:PAPER_ID`` or just ``PAPER_ID``."""
    if ":" not in cid:
        cid = f"{SCHOLAR_ID}:{cid}"
    return f"https://scholar.google.com/citations?view_op=view_citation&hl=en&user={SCHOLAR_ID}&citation_for_view={cid}"


def _classify(venue: str, title: str = "") -> str:
    text = f"{venue} {title}".lower()
    if any(hint in text for hint in PREPRINT_HINTS):
        return "preprint"
    if any(hint in text for hint in JOURNAL_HINTS):
        return "journal"
    if any(hint in text for hint in CONFERENCE_HINTS):
        return "conference"
    return "other"


def _normalize_publication(cid: str, title: str, authors: str, venue: str,
                           year, citations, url: str | None = None) -> dict:
    cid = cid or re.sub(r"[^A-Za-z0-9_-]", "", title)[:32]
    venue = re.sub(r"\s+", " ", (venue or "").strip())
    venue = re.sub(r"\s+,", ",", venue)                 # Scholar emits "Venue , 2026"
    venue = re.sub(r",?\s*\b(19|20)\d{2}\b\s*$", "", venue)  # year is a separate field
    venue = venue.rstrip(" ,…\u2026").strip()
    arxiv_match = re.search(r"arXiv:\s*([0-9]{4}\.[0-9]{4,5})(v\d+)?", venue, re.I)
    return {
        "id": cid,
        "title": re.sub(r"\s+", " ", (title or "").strip()),
        "authors": re.sub(r"\s+", " ", (authors or "").strip()),
        "venue": venue,
        "year": _int(year),
        "citations": _int(citations),
        "type": _classify(venue, title),
        "eprint_url": f"https://arxiv.org/abs/{arxiv_match.group(1)}" if arxiv_match else None,
        "url": url or _citation_url(cid),
    }


def _parse_publication_rows(rows) -> list:
    parsed = []
    for row in rows:
        title_link = row.select_one("a.gsc_a_at")
        if not title_link:
            continue
        href = title_link.get("href", "")
        cid_match = re.search(r"citation_for_view=([^&]+)", href)
        cid = cid_match.group(1) if cid_match else ""
        grays = row.select("td.gsc_a_t div.gs_gray")
        authors = grays[0].get_text(" ", strip=True) if grays else ""
        venue = grays[1].get_text(" ", strip=True) if len(grays) > 1 else ""
        year = row.select_one("td.gsc_a_y")
        cites = row.select_one("td.gsc_a_c a") or row.select_one("td.gsc_a_c")
        link = ("https://scholar.google.com" + href) if href.startswith("/") else (
            _citation_url(cid) if cid else "")
        parsed.append(_normalize_publication(
            cid,
            title_link.get_text(" ", strip=True),
            authors,
            venue,
            year.get_text(" ", strip=True) if year else "",
            cites.get_text(" ", strip=True) if cites else 0,
            link,
        ))
    return parsed


def scrape_profile_html() -> dict:
    """Parse the public profile page directly, trying every regional host."""
    errors = []
    for host in SCHOLAR_HOSTS:
        try:
            return _scrape_from_host(host)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{host}: {type(exc).__name__}: {exc}")
    raise RuntimeError("all Scholar hosts failed -> " + " | ".join(errors))


def _scrape_from_host(works_url: str) -> dict:
    """Parse the public profile page directly (no third-party Scholar API)."""
    params = {
        "user": SCHOLAR_ID,
        "hl": "en",
        "view_op": "list_works",
        "sortby": "pubdate",
        "pagesize": 100,
    }
    soup = None
    publications = []
    # Scholar paginates in blocks of 100; walk the pages so nothing is dropped.
    for cstart in range(0, 500, 100):
        params["cstart"] = cstart
        response = requests.get(works_url, params=params, headers=HEADERS,
                                timeout=30, proxies=PROXIES)
        response.raise_for_status()
        html = response.text
        if "gsc_a_b" not in html or "not a robot" in html.lower() or "unusual traffic" in html.lower():
            raise RuntimeError("Scholar returned a blocked / CAPTCHA page instead of the profile")
        page_soup = BeautifulSoup(html, "html.parser")
        if soup is None:
            soup = page_soup  # first page also holds the profile header and metrics
        rows = page_soup.select("tr.gsc_a_tr")
        if not rows:
            break
        publications.extend(_parse_publication_rows(rows))
        if len(rows) < 100:
            break

    if soup is None:
        raise RuntimeError("Scholar responded with no profile content")
    name_tag = soup.select_one("#gsc_prf_in")
    if not name_tag:
        raise RuntimeError("Profile name element not found")
    name = name_tag.get_text(strip=True)
    affiliation = soup.select_one(".gsc_prf_il")
    interests = [a.get_text(strip=True) for a in soup.select("#gsc_prf_int a")]

    metrics = {
        "citations": 0, "citations_recent": 0,
        "h_index": 0, "h_index_recent": 0,
        "i10_index": 0, "i10_index_recent": 0,
    }
    metric_rows = soup.select("#gsc_rsb_st tr")
    keys = [
        ("citations", "citations_recent"),
        ("h_index", "h_index_recent"),
        ("i10_index", "i10_index_recent"),
    ]
    for row, pair in zip(metric_rows[1:4], keys):
        cells = row.select("td.gsc_rsb_std")
        if len(cells) >= 2:
            metrics[pair[0]] = _int(cells[0].get_text())
            metrics[pair[1]] = _int(cells[1].get_text())

    if not publications:
        raise RuntimeError("Profile found but publication rows could not be parsed")
    return build_snapshot(name, affiliation.get_text(" ", strip=True) if affiliation else "",
                           interests, metrics, publications, source="html")


def scrape_with_scholarly() -> dict:
    """Use the `scholarly` package, which yields richer bibliographic metadata."""
    from scholarly import scholarly

    author = scholarly.search_author_id(SCHOLAR_ID)
    scholarly.fill(author, sections=["basics", "indices", "counts", "publications"])

    metrics = {
        "citations": _int(author.get("citedby")),
        "citations_recent": _int(author.get("citedby5y")),
        "h_index": _int(author.get("hindex")),
        "h_index_recent": _int(author.get("hindex5y")),
        "i10_index": _int(author.get("i10index")),
        "i10_index_recent": _int(author.get("i10index5y")),
    }
    interests = author.get("interests", []) or []
    publications = []
    for pub in author.get("publications", []) or []:
        bib = pub.get("bib", {}) or {}
        cid = str(pub.get("author_pub_id", "")).strip()
        year = bib.get("pub_year") or ""
        venue_parts = [bib.get(k) for k in ("journal", "conference", "publisher", "institution", "repository")]
        venue = next((v for v in venue_parts if v), "") or ""
        tail = bib.get("number") or bib.get("volume") or bib.get("pages") or ""
        if tail and str(tail) not in venue:
            venue = f"{venue}, {tail}" if venue else str(tail)
        if year and str(year) not in venue:
            venue = f"{venue}, {year}" if venue else str(year)
        publications.append(_normalize_publication(
            cid,
            bib.get("title", ""),
            bib.get("author", ""),
            venue,
            year,
            pub.get("num_citations", 0),
        ))

    if not publications:
        raise RuntimeError("scholarly returned no publications")
    return build_snapshot(author.get("name", "Zhengxin Fang"), author.get("affiliation", ""),
                          interests, metrics, publications, source="scholarly")


def build_snapshot(name, affiliation, interests, metrics, publications, source) -> dict:
    publications.sort(key=lambda p: (-p["year"], -p["citations"], p["title"].lower()))
    return {
        "schema_version": 2,
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": SCHOLAR_URL,
        "fetch_strategy": source,
        "scholar_id": SCHOLAR_ID,
        "name": name,
        "affiliation": affiliation,
        "interests": interests,
        "metrics": metrics,
        # Legacy keys kept so older citation-badge markup keeps working.
        "citedby": metrics["citations"],
        "hindex": metrics["h_index"],
        "publication_count": len(publications),
        "publications": publications,
        "publication_index": {
            p["id"]: {"num_citations": p["citations"], "title": p["title"]}
            for p in publications
        },
    }


def write_outputs(data: dict) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "gs_data.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (RESULTS / "gs_data_shieldsio.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "label": "citations",
            "message": str(data["metrics"]["citations"]),
        }, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    data = None
    for strategy in (scrape_profile_html, scrape_with_scholarly):
        try:
            candidate = strategy()
            if candidate["publications"]:
                data = candidate
                print(f"[ok] {strategy.__name__}: {len(data['publications'])} publications, "
                      f"{data['metrics']['citations']} citations")
                break
        except Exception as exc:  # noqa: BLE001 - one strategy failing must not abort the other
            print(f"[warn] {strategy.__name__} failed: {type(exc).__name__}: {exc}", file=sys.stderr)

    if data is None:
        print("[error] All Scholar fetch strategies failed. Keeping the previous snapshot "
              "(no files written).", file=sys.stderr)
        return 1

    write_outputs(data)
    print(f"[done] wrote {RESULTS / 'gs_data.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
