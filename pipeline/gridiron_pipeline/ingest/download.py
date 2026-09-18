"""Idempotent, cached downloads of nflverse releases.

Convention shared with ratings-model: cache raw files at
`pipeline/.cache/raw/<basename of URL>`; write to a temp file then rename;
skip the network entirely if the destination already exists.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlparse

import requests

from gridiron_pipeline import CACHE_DIR

log = logging.getLogger(__name__)

RAW_DIR = CACHE_DIR / "raw"
TIMEOUT_S = 120


def raw_path(url: str) -> Path:
    return RAW_DIR / Path(urlparse(url).path).name


def cached_download(url: str) -> Path:
    """Download `url` into RAW_DIR unless it is already cached. Returns the local path."""
    dest = raw_path(url)
    if dest.exists():
        log.info("cache hit: %s", dest.name)
        return dest

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    log.info("downloading %s", url)
    with requests.get(url, stream=True, timeout=TIMEOUT_S) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    os.replace(tmp, dest)
    return dest


def download_all(urls: list[str]) -> dict[str, Path]:
    return {url: cached_download(url) for url in urls}
