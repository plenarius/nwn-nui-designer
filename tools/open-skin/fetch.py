#!/usr/bin/env python3
"""Downloads every font in sources.toml into a cache folder, checks its sha256 and fetches its licence text.
Default cache: $NUI_SKIN_CACHE, else ~/.cache/nwn-nui-designer/open-skin.

    fetch.py [--cache DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tomllib
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 (compatible; nwn-nui-designer-open-skin-fetch)"}


def cache_dir(arg: str | None = None) -> Path:
    p = Path(arg or os.environ.get("NUI_SKIN_CACHE") or Path.home() / ".cache/nwn-nui-designer/open-skin")
    p.mkdir(parents=True, exist_ok=True)
    return p


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def fetch_one(url: str, sha: str | None, dest: Path) -> Path:
    if not dest.is_file() or (sha and hashlib.sha256(dest.read_bytes()).hexdigest() != sha):
        data = get(url)
        got = hashlib.sha256(data).hexdigest()
        if sha and got != sha:
            raise SystemExit(f"{url}: sha256 {got}, expected {sha}")
        dest.write_bytes(data)
    return dest


def fetch_all(cache: Path) -> dict:
    src = tomllib.loads((HERE / "sources.toml").read_text())
    for key, f in src.get("fonts", {}).items():
        d = cache / "fonts" / key
        d.mkdir(parents=True, exist_ok=True)
        fetch_one(f["url"], f["sha256"], d / Path(f["url"]).name)
        fetch_one(f["licence_url"], None, d / "OFL.txt")
    return src


def font_path(cache: Path, src: dict, key: str) -> Path:
    return cache / "fonts" / key / Path(src["fonts"][key]["url"]).name


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache")
    a = ap.parse_args()
    c = cache_dir(a.cache)
    fetch_all(c)
    print(f"fetched into {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
