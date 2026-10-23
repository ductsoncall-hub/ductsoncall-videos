# Ducts On Call — Video Archive

A free, static, searchable archive of every video on the [DUCTS ON CALL YouTube channel](https://www.youtube.com/@ductsoncall3320),
built for [ductsoncall.com](https://ductsoncall.com) (NADCA-certified air duct & dryer vent cleaning, Madison, WI).

**Live site:** https://ductsoncall-hub.github.io/ductsoncall-videos/

## What's inside

- `index.html`, `style.css`, `app.js` — the site. No build step, no framework, no tracking.
- `data/videos.json` — every video (title, description, date, type, duration, views, topics, playlist).
- `scripts/update_from_rss.py` — pulls new uploads from the channel's public RSS feed, then sweeps the channel's Videos and Shorts tabs for anything the 15-item feed missed, and merges them in.
- `.github/workflows/update-archive.yml` — runs the updater every 3 days and commits any changes, so new
  videos appear on the site automatically.

## Features

- Instant full-text search across titles and descriptions (press `/` anywhere).
- Filter by type (videos / Shorts), topic, and year; sort by date, views or title.
- Watch in-page with an embedded player; previous / next and arrow-key browsing.
- Every search, filter, and video has a shareable URL (e.g. `?q=mold`, `?v=VIDEO_ID`).
- Works on phones; no accounts, cookies or ads.

## Hosting

Served for free by GitHub Pages from the `main` branch. To host elsewhere (Netlify, Cloudflare Pages, Vercel),
point the service at this repository: it is a plain static folder with `index.html` at the root.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Refresh the archive manually

```bash
python3 scripts/update_from_rss.py
```
