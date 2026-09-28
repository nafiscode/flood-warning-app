"""Polite HTTP client for the ThaiWater public API: rate limit, retries with backoff, block detection."""

from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


class BlockedError(RuntimeError):
    """Too many consecutive failures: the API is down or is blocking us."""


class ApiError(ValueError):
    """HTTP 200 but {"result": "NO", "data": "<message>"}. Server-side errors (for example
    '500: Internal Database Error ... out of shared memory') are retried; others are not."""

    def __init__(self, message: str):
        super().__init__(message)
        self.retryable = message.startswith("5") or "Internal" in message


class ThaiWaterClient:
    def __init__(self, cfg: dict):
        http = cfg["http"]
        self.min_interval = float(http["min_interval_seconds"])
        self.retries = int(http["retries"])
        self.blocked_after = int(http["blocked_after_failures"])
        self._http = httpx.Client(
            base_url=cfg["api_base"],
            headers={"User-Agent": cfg["user_agent"], "Accept": "application/json"},
            timeout=float(http["timeout_seconds"]),
            follow_redirects=True,
        )
        self._last = 0.0
        self.requests = 0
        self.consecutive_failures = 0
        self.last_raw: bytes = b""  # body of the last successful response, saved as-is by callers

    def close(self) -> None:
        self._http.close()

    def _pace(self) -> None:
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, path: str, params: dict | None = None) -> dict:
        """GET a JSON endpoint. Raises after retries; raises BlockedError after too many
        consecutive failed calls so a scheduled run fails loudly instead of silently."""
        for attempt in range(1, self.retries + 1):
            self._pace()
            self.requests += 1
            try:
                r = self._http.get(path, params=params)
                if r.status_code in RETRY_STATUS:
                    raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                payload = r.json()
                if not isinstance(payload, dict):
                    raise ApiError(f"unexpected response type {type(payload).__name__}")
                if payload.get("result") == "NO":
                    raise ApiError(str(payload.get("data"))[:200])
                self.last_raw = r.content
                self.consecutive_failures = 0
                return payload
            except (httpx.TransportError, httpx.HTTPStatusError, ValueError) as exc:
                if isinstance(exc, ApiError):
                    retryable = exc.retryable
                elif isinstance(exc, httpx.HTTPStatusError):
                    retryable = exc.response.status_code in RETRY_STATUS
                else:
                    retryable = True
                if retryable and attempt < self.retries:
                    backoff = min(120, 5 * 2**attempt)  # 10, 20, 40, 80 s: give an overloaded server room
                    log.warning("GET %s %s failed (%s); retry %d in %ds", path, params, exc, attempt, backoff)
                    time.sleep(backoff)
                    continue
                self.consecutive_failures += 1
                log.error("GET %s %s failed permanently: %s", path, params, exc)
                if self.consecutive_failures >= self.blocked_after:
                    raise BlockedError(
                        f"{self.consecutive_failures} consecutive failed requests; last: {exc}"
                    ) from exc
                raise
        raise AssertionError("unreachable")
