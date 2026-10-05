"""Otsu threshold and the bimodality test on a histogram of the change image. Pure numpy.

The histogram is of (event - reference) backscatter in dB for one tile and one polarisation:
unchanged land sits near 0 dB, newly flooded land forms a second mode several dB below it.

Otsu always returns a threshold, also for a histogram with one mode, where it only cuts the single
hump in two. So a tile's Otsu threshold is accepted only when the histogram passes every test in
`decide`; otherwise the tile gets the fixed backscatter drop. The same functions are ported line by
line to JavaScript in code_editor/sar_floods.js.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class Decision:
    method: str                 # "otsu" or "fallback"
    threshold_db: float         # flooded where change < threshold_db
    reason: str                 # "bimodal", or why Otsu was not used
    pixels: float               # histogram total (weighted pixel count)
    otsu_db: float | None = None          # the Otsu threshold, also when it was rejected
    low_fraction: float | None = None     # share of pixels below the Otsu threshold
    mode_low_db: float | None = None
    mode_high_db: float | None = None
    valley_ratio: float | None = None
    eta: float | None = None              # between-class variance / total variance (diagnostic only)

    def as_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in asdict(self).items() if v is not None}


def bin_edges(min_db: float, max_db: float, n_bins: int) -> np.ndarray:
    return np.linspace(min_db, max_db, n_bins + 1)


def otsu(counts, edges) -> tuple[float, float, float]:
    """Otsu's threshold for a histogram.

    Returns (threshold, low_fraction, eta). The threshold is a bin edge: bins left of it are the low
    class. When several neighbouring edges tie for the maximum between-class variance (an empty gap
    between two well-separated classes), the middle of that gap is returned.
    """
    counts = np.asarray(counts, dtype=float)
    edges = np.asarray(edges, dtype=float)
    centers = (edges[:-1] + edges[1:]) / 2
    total = counts.sum()
    if total <= 0 or np.count_nonzero(counts) < 2:
        raise ValueError("Otsu needs at least two non-empty bins.")
    w0 = np.cumsum(counts)[:-1]                  # weight of the low class for a split after bin k
    w1 = total - w0
    s0 = np.cumsum(counts * centers)[:-1]
    ok = (w0 > 0) & (w1 > 0)
    mean0 = np.divide(s0, w0, out=np.zeros_like(s0), where=ok)
    mean1 = np.divide((counts * centers).sum() - s0, w1, out=np.zeros_like(s0), where=ok)
    between = np.where(ok, w0 * w1 * (mean0 - mean1) ** 2, 0.0) / total**2
    best = between.max()
    ties = np.flatnonzero(between >= best * (1 - 1e-9))
    k = int(ties[0])
    # Only a run of neighbouring ties is one gap; take its middle.
    run = ties[: np.argmax(np.diff(ties) > 1) + 1] if np.any(np.diff(ties) > 1) else ties
    threshold = float((edges[run[0] + 1] + edges[run[-1] + 1]) / 2)
    mean = (counts * centers).sum() / total
    variance = (counts * (centers - mean) ** 2).sum() / total
    return threshold, float(w0[k] / total), float(best / variance) if variance > 0 else 0.0


def smooth(counts, width: int) -> np.ndarray:
    """Centred moving average over `width` bins (odd), with zero padding at both ends."""
    counts = np.asarray(counts, dtype=float)
    if width <= 1:
        return counts
    return np.convolve(counts, np.ones(width) / width, mode="same")


def decide(counts, edges, *, fallback_db: float, min_pixels: float, min_class_fraction: float,
           smooth_bins: int, max_valley_ratio: float, min_mode_separation_db: float,
           otsu_range_db: tuple[float, float]) -> Decision:
    """Choose a tile's threshold: Otsu if the histogram is bimodal enough, else the fixed drop.

    Tests, in order (the first failure is the logged reason):
      too_few_pixels     fewer than min_pixels valid pixels in the tile
      class_too_small    one side of the Otsu threshold holds less than min_class_fraction of the pixels
      no_valley          on the smoothed histogram, the lowest point between the mode below and the
                         mode above the threshold is more than max_valley_ratio x the smaller mode.
                         A single hump fails here: both "modes" then sit right at the threshold.
      modes_too_close    the two modes are less than min_mode_separation_db apart
      out_of_range       the threshold is outside otsu_range_db (not a plausible flood drop)
    """
    counts = np.asarray(counts, dtype=float)
    edges = np.asarray(edges, dtype=float)
    pixels = float(counts.sum())

    def fallback(reason: str, **stats) -> Decision:
        return Decision("fallback", float(fallback_db), reason, pixels, **stats)

    if pixels < min_pixels or np.count_nonzero(counts) < 2:
        return fallback("too_few_pixels")
    t, low_fraction, eta = otsu(counts, edges)
    stats = {"otsu_db": t, "low_fraction": low_fraction, "eta": eta}
    if min(low_fraction, 1 - low_fraction) < min_class_fraction:
        return fallback("class_too_small", **stats)

    centers = (edges[:-1] + edges[1:]) / 2
    sm = smooth(counts, smooth_bins)
    split = int(np.searchsorted(edges, t, side="right")) - 1   # first bin of the high class
    split = min(max(split, 1), len(counts) - 1)
    lo = int(np.argmax(sm[:split]))
    hi = split + int(np.argmax(sm[split:]))
    valley = float(sm[lo:hi + 1].min())
    valley_ratio = valley / float(min(sm[lo], sm[hi]))
    stats.update(mode_low_db=float(centers[lo]), mode_high_db=float(centers[hi]), valley_ratio=valley_ratio)
    if valley_ratio > max_valley_ratio:
        return fallback("no_valley", **stats)
    if centers[hi] - centers[lo] < min_mode_separation_db:
        return fallback("modes_too_close", **stats)
    if not otsu_range_db[0] <= t <= otsu_range_db[1]:
        return fallback("out_of_range", **stats)
    return Decision("otsu", t, "bimodal", pixels, **stats)


def decide_from_config(counts, cfg: dict, pol: str) -> Decision:
    th = cfg["threshold"]
    h, b = th["histogram"], th["bimodality"]
    n_bins = int(round((h["max_db"] - h["min_db"]) / h["bin_db"]))
    if len(counts) != n_bins:
        raise ValueError(f"Expected {n_bins} histogram bins, got {len(counts)}.")
    return decide(counts, bin_edges(h["min_db"], h["max_db"], n_bins),
                  fallback_db=th["fallback_drop_db"][pol], min_pixels=b["min_pixels"],
                  min_class_fraction=b["min_class_fraction"], smooth_bins=b["smooth_bins"],
                  max_valley_ratio=b["max_valley_ratio"], min_mode_separation_db=b["min_mode_separation_db"],
                  otsu_range_db=tuple(th["otsu_range_db"]))


def summarise(decisions: dict[int, Decision]) -> dict:
    """One line per scene and polarisation for the log: how many tiles used Otsu, and the spread."""
    otsu_db = sorted(d.threshold_db for d in decisions.values() if d.method == "otsu")
    reasons: dict[str, int] = {}
    for d in decisions.values():
        reasons[d.reason] = reasons.get(d.reason, 0) + 1
    out = {"tiles_with_data": len(decisions), "tiles_otsu": len(otsu_db), "reasons": dict(sorted(reasons.items()))}
    if otsu_db:
        out.update(otsu_min_db=round(otsu_db[0], 2), otsu_median_db=round(float(np.median(otsu_db)), 2),
                   otsu_max_db=round(otsu_db[-1], 2))
    return out
