#!/usr/bin/env python3
"""Pull new uploads into data/videos.json. Runs on a schedule via GitHub Actions.

Step 1: the channel's public RSS feed (no API key) gives full titles, descriptions
        and view counts for the 15 most recent uploads.
Step 2: a fallback sweep of the channel's Videos and Shorts tabs (via yt-dlp, if
        installed) catches anything older than the feed window that is still
        missing from the archive, so a multi-day schedule never drops a video.
"""
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

CHANNEL_ID = "UCAnxNY8XmPkzigamDoIeTow"
FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
DATA = Path(__file__).resolve().parent.parent / "data" / "videos.json"
NS = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}

TOPICS = {
    "Mold": r"\bmold|mildew|bio-?growth|fung",
    "Mycotoxins": r"mycotoxin",
    "VOCs & Formaldehyde": r"\bvoc|formaldehyde|off-?gas",
    "Filtration & PM2.5": r"pm ?2\.5|particulate|\bfilter|filtration|hepa|merv|purifier|smoke",
    "Radon & CO": r"radon|carbon monoxide|generator",
    "Cooking & Gas Stoves": r"gas stove|cooking|cooktop|range hood|nitrogen dioxide|no₂|\bno2\b",
    "Ventilation & Fresh Air": r"ventilat|fresh air|ashrae|air exchange|airtight",
    "Dryer Vents": r"dryer|lint",
    "Duct Cleaning": r"\bduct|hvac|register|furnace",
    "Humidity": r"humid|moisture|condensation|dehumid",
    "Allergies & Dust": r"allerg|\bdust|dander|pollen|asthma",
    "Routines & Maintenance": r"routine|checklist|maintenance|seasonal|daily|weekly|winter|spring\b|summer",
    "Hiring & Pricing": r"hire|hiring|cost|price|scam|questions|nadca|contractor|quote",
}


def topics_for(title: str, description: str) -> list[str]:
    def match(text):
        return [k for k, rx in TOPICS.items() if re.search(rx, text)]

    lead = re.sub(r"https?://\S+", "", description.split("\n\n")[0])
    t = match(title.lower())
    for k in match(lead.lower()):
        if k not in t and len(t) < 3:
            t.append(k)
    return t[:3] or ["Indoor Air Quality"]


def is_short(video_id: str) -> bool:
    """YouTube serves /shorts/<id> directly for Shorts and redirects everything else."""
    req = urllib.request.Request(f"https://www.youtube.com/shorts/{video_id}", method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=15) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        return e.code == 200
    except Exception:
        return False


def sweep_channel_tabs(by_id: dict) -> bool:
    """Add any video listed on the channel's Videos/Shorts tabs that the feed missed."""
    if not shutil.which("yt-dlp"):
        print("yt-dlp not installed; skipping channel sweep.")
        return False
    changed = False
    now = datetime.now(timezone.utc)
    for tab, kind in (("videos", "video"), ("shorts", "short")):
        url = f"https://www.youtube.com/channel/{CHANNEL_ID}/{tab}"
        try:
            out = subprocess.run(
                ["yt-dlp", "--flat-playlist", "-J", "--no-warnings",
                 "--extractor-args", "youtubetab:approximate_date", url],
                capture_output=True, text=True, timeout=180, check=True).stdout
            entries = json.loads(out).get("entries") or []
        except Exception as exc:  # network hiccup or bot wall: just skip the sweep
            print(f"Channel sweep of /{tab} failed: {exc}")
            continue
        for e in entries:
            vid = e.get("id")
            if not vid or vid in by_id:
                continue
            ts = e.get("timestamp")
            when = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else now
            title = e.get("title") or vid
            by_id[vid] = {
                "id": vid,
                "title": title,
                "kind": kind,
                "duration": e.get("duration"),
                "views": e.get("view_count"),
                "published": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "description": "",
                "playlists": [],
                "topics": topics_for(title, ""),
                "year": when.strftime("%Y"),
                "url": f"https://www.youtube.com/{'shorts/' if kind == 'short' else 'watch?v='}{vid}",
            }
            changed = True
            print(f"+ {kind:5s} {when.strftime('%Y-%m-%d')} {title}  (from channel sweep)")
    return changed


def main() -> int:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    by_id = {v["id"]: v for v in data["videos"]}

    entries = []
    for attempt in range(1, 5):  # YouTube occasionally answers 5xx; retry, then fall back to the sweep
        try:
            with urllib.request.urlopen(FEED_URL, timeout=30) as resp:
                entries = ET.fromstring(resp.read()).findall("a:entry", NS)
            break
        except Exception as exc:
            print(f"Feed fetch attempt {attempt} failed: {exc}")
            if attempt < 4:
                time.sleep(20 * attempt)
    if not entries:
        print("Feed unavailable; relying on the channel sweep for this run.")

    changed = False
    for entry in entries:
        vid = entry.findtext("yt:videoId", namespaces=NS)
        title = entry.findtext("a:title", namespaces=NS) or ""
        published = entry.findtext("a:published", namespaces=NS) or ""
        group = entry.find("media:group", NS)
        description = (group.findtext("media:description", namespaces=NS) if group is not None else "") or ""
        stats = group.find("media:community/media:statistics", NS) if group is not None else None
        views = int(stats.get("views")) if stats is not None and stats.get("views") else None

        if vid in by_id:
            v = by_id[vid]
            if views is not None and views != v.get("views"):
                v["views"] = views
                changed = True
            if title and title != v["title"]:
                v["title"] = title
                v["topics"] = topics_for(title, v.get("description", ""))
                changed = True
            continue

        short = "#shorts" in title.lower() or is_short(vid)
        iso = datetime.fromisoformat(published.replace("Z", "+00:00")).astimezone(timezone.utc)
        v = {
            "id": vid,
            "title": title,
            "kind": "short" if short else "video",
            "duration": None,
            "views": views,
            "published": iso.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "description": description.strip(),
            "playlists": [],
            "topics": topics_for(title, description),
            "year": iso.strftime("%Y"),
            "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{vid}",
        }
        by_id[vid] = v
        changed = True
        print(f"+ {v['kind']:5s} {v['published'][:10]} {title}")

    if sweep_channel_tabs(by_id):
        changed = True

    if not changed:
        print("No changes.")
        return 0

    videos = sorted(by_id.values(), key=lambda v: v["published"], reverse=True)
    data["videos"] = videos
    data["channel"]["videoCount"] = len(videos)
    data["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(videos)} videos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
