"""Pairing radar passes with the gauge and fitting the offset z0.

The model: at gauge stage s (m MSL) a cell of the reach is under water when its height h above the
reach's river is below s - z0. z0 is the gauge reading at which the river stands at the elevation
model's own water surface (the zero of h). One z0 per gauge.

A pass is kept as two height histograms over the reach's scored cells: the cells the radar saw
flooded and the cells it saw dry. Any z0 can then be scored without reading a raster again.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def stage_at(level: pd.Series, t: pd.Timestamp, max_offset_h: float) -> tuple[float, float] | None:
    """(stage, offset in hours) of the reading nearest to t, if within `max_offset_h`."""
    s = level.dropna()
    if s.empty:
        return None
    i = int(s.index.get_indexer([t], method="nearest")[0])
    if i < 0:
        return None
    off = abs((s.index[i] - t).total_seconds()) / 3600.0
    if off > max_offset_h:
        return None
    return float(s.iloc[i]), round(off, 2)


def histograms(height: np.ndarray, observed: np.ndarray, scored: np.ndarray, bin_m: float,
               max_height_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Counts of flooded and of dry scored cells per height bin [i*bin, (i+1)*bin). The last bin holds
    everything at or above `max_height_m` (never predicted flooded)."""
    nb = int(round(max_height_m / bin_m)) + 1
    ok = scored & np.isfinite(height) & (observed >= 0)
    idx = np.clip(np.floor(height[ok] / bin_m).astype("int64"), 0, nb - 1)
    obs = observed[ok]
    flooded = np.bincount(idx[obs == 1], minlength=nb)
    dry = np.bincount(idx[obs == 0], minlength=nb)
    return flooded.astype("int64"), dry.astype("int64")


def counts(flooded: np.ndarray, dry: np.ndarray, stages: np.ndarray, z0s: np.ndarray, bin_m: float) -> tuple[np.ndarray, ...]:
    """Pooled (TP, FP, FN) over the passes for each z0. `flooded`, `dry`: (passes, bins); `stages`:
    (passes,). The cells of bin i are predicted flooded when (i+1)*bin <= s - z0."""
    nb = flooded.shape[1]
    cf = np.concatenate([np.zeros((flooded.shape[0], 1), "int64"), np.cumsum(flooded, axis=1)], axis=1)
    cd = np.concatenate([np.zeros((dry.shape[0], 1), "int64"), np.cumsum(dry, axis=1)], axis=1)
    depth = stages[None, :] - z0s[:, None]                                   # (z0s, passes)
    n = np.clip(np.floor(depth / bin_m + 1e-9).astype("int64"), 0, nb - 1)   # the overflow bin is never wet
    rows = np.arange(flooded.shape[0])[None, :]
    tp = cf[rows, n].sum(axis=1)
    fp = cd[rows, n].sum(axis=1)
    fn = flooded.sum() - tp
    return tp, fp, fn


def metrics(tp: float, fp: float, fn: float) -> dict:
    def ratio(a, b):
        return None if b == 0 else round(float(a) / float(b), 3)

    # bias: the area the model calls wet over the area the radar saw wet (1 = the same size).
    return {"csi": ratio(tp, tp + fp + fn), "hit_rate": ratio(tp, tp + fn), "false_alarm_ratio": ratio(fp, tp + fp),
            "bias": ratio(tp + fp, tp + fn), "tp": int(tp), "fp": int(fp), "fn": int(fn)}


def best_z0(flooded: np.ndarray, dry: np.ndarray, stages: np.ndarray, z0s: np.ndarray, bin_m: float) -> tuple[float, np.ndarray]:
    """The z0 with the highest pooled CSI (the middle of a run of equal best values), and the CSI curve."""
    tp, fp, fn = counts(flooded, dry, stages, z0s, bin_m)
    denom = tp + fp + fn
    csi = np.where(denom > 0, tp / np.maximum(denom, 1), 0.0)
    top = np.flatnonzero(csi >= csi.max() - 1e-12)
    return float(z0s[top[len(top) // 2]]), csi


def score(flooded: np.ndarray, dry: np.ndarray, stages: np.ndarray, z0: float, bin_m: float) -> dict:
    tp, fp, fn = counts(flooded, dry, stages, np.array([z0]), bin_m)
    return metrics(tp[0], fp[0], fn[0])


def ceiling(flooded: np.ndarray, dry: np.ndarray, stages: np.ndarray, z0: float, bin_m: float) -> dict:
    """Mean CSI per pass at z0, against the mean CSI per pass when each pass gets the height cut that
    suits it best. The second is the most a single height cut could do on these passes (whatever the
    gauge said); the gap is what z0 and the stage cost, the rest is the height model and the radar."""
    best, at_z0 = [], []
    for f, d, s in zip(flooded, dry, stages):
        if f.sum() == 0:
            continue
        cf = np.concatenate([[0], np.cumsum(f)])
        cd = np.concatenate([[0], np.cumsum(d)])
        denom = f.sum() + cd                                 # tp + fp + fn = cf + cd + (total - cf)
        csi = np.where(denom > 0, cf / np.maximum(denom, 1), 0.0)
        best.append(float(csi[:-1].max()))                   # the overflow bin is never wet
        at_z0.append(score(f[None, :], d[None, :], np.array([s]), z0, bin_m)["csi"] or 0.0)
    if not best:
        return {"passes": 0}
    return {"passes": len(best), "mean_csi_at_z0": round(float(np.mean(at_z0)), 3),
            "mean_csi_best_cut_per_pass": round(float(np.mean(best)), 3)}


def leave_one_out(groups: np.ndarray, flooded: np.ndarray, dry: np.ndarray, stages: np.ndarray, z0s: np.ndarray,
                  bin_m: float) -> dict:
    """Leave each group (season) out in turn: fit z0 on the others, score the left-out passes with it.
    The held-out counts are pooled over the groups. A group cannot be held out when the others hold
    no flooded cell at all (nothing to fit on)."""
    tp = fp = fn = 0
    folds = []
    for g in sorted(set(groups.tolist())):
        out = groups == g
        rest = ~out
        if flooded[rest].sum() == 0:
            folds.append({"group": int(g), "passes": int(out.sum()), "z0": None})
            continue
        z0, _ = best_z0(flooded[rest], dry[rest], stages[rest], z0s, bin_m)
        m = score(flooded[out], dry[out], stages[out], z0, bin_m)
        tp, fp, fn = tp + m["tp"], fp + m["fp"], fn + m["fn"]
        folds.append({"group": int(g), "passes": int(out.sum()), "z0": round(z0, 2), **m})
    return {"pooled": metrics(tp, fp, fn), "folds": folds}
