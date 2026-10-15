"""Which side of a section is upstream, what the radar says about the two sides, the score, the class
and the reasons in plain words. Pure functions over numbers; nothing here reads a file.

A class says where to look first, never what is there: "look here first", "worth a look", "no sign"
(the radar shows nothing to point at), "not seen" (the radar could not see enough of both sides).
"""

from __future__ import annotations

import math

import numpy as np

LOOK_FIRST, WORTH, NO_SIGN, NOT_SEEN = "look_first", "worth_a_look", "no_sign", "not_seen"
CLASS_WORDS = {LOOK_FIRST: "look here first", WORTH: "worth a look", NO_SIGN: "no sign", NOT_SEEN: "not seen"}
SIDE_WORDS = {0: "left", 1: "right"}


def upstream(d8_toward: tuple[float, float], dem_mean: tuple[float, float], crossing_from: int | None,
             d8_margin: float, dem_margin_m: float) -> dict:
    """The upstream side (0 left, 1 right, None unclear) and how it was decided.

    D8 first: the side where a larger share of the land drains towards the road (by at least
    `d8_margin`). Then a crossing stream: the side it comes from. Then the DEM: the side higher on
    average by at least `dem_margin_m`. Each verdict is kept, and whether D8 and the DEM agree."""
    d8_side = dem_side = None
    a, b = d8_toward
    if np.isfinite(a) and np.isfinite(b) and abs(a - b) >= d8_margin:
        d8_side = 0 if a > b else 1
    h0, h1 = dem_mean
    if np.isfinite(h0) and np.isfinite(h1) and abs(h0 - h1) >= dem_margin_m:
        dem_side = 0 if h0 > h1 else 1
    if d8_side is not None:
        side, by = d8_side, "d8"
    elif crossing_from is not None:
        side, by = crossing_from, "crossing"
    elif dem_side is not None:
        side, by = dem_side, "dem"
    else:
        side, by = None, "unclear"
    agree = None if d8_side is None or dem_side is None else d8_side == dem_side
    return {"side": side, "by": by, "d8_side": d8_side, "dem_side": dem_side, "agree": agree}


def share(flooded: np.ndarray, observed: np.ndarray, min_cells: int) -> np.ndarray:
    """flooded / observed, NaN where fewer than `min_cells` were observed."""
    flooded, observed = np.asarray(flooded, "float64"), np.asarray(observed, "float64")
    with np.errstate(all="ignore"):
        return np.where(observed >= min_cells, flooded / np.maximum(observed, 1), np.nan)


def seasons(up_share: np.ndarray, down_share: np.ndarray, up_flooded: np.ndarray, down_flooded: np.ndarray,
            wetter_by: float, min_flooded_cells: int) -> dict:
    """Season by season: the mean of (upstream - downstream share) over the seasons where both sides
    were seen, and how many seasons each side was clearly wetter."""
    both = np.isfinite(up_share) & np.isfinite(down_share)
    diff = (up_share - down_share)[both]
    up_wet = both & (up_share - down_share >= wetter_by) & (np.asarray(up_flooded) >= min_flooded_cells)
    down_wet = both & (down_share - up_share >= wetter_by) & (np.asarray(down_flooded) >= min_flooded_cells)
    return {"seen": int(both.sum()), "asymmetry": float(diff.mean()) if len(diff) else None,
            "up_wetter": int(up_wet.sum()), "down_wetter": int(down_wet.sum())}


OPENING_WORDS = {"bridge": "bridge", "culvert": "culvert", "waterway": "waterway crossing (opening not tagged)"}


def has_opening(distance_m: float | None, cfg: dict) -> bool:
    """A mapped opening counts for a crossing when it is within `crossings.opening_m`."""
    return distance_m is not None and distance_m <= cfg["crossings"]["opening_m"]


def part(value: float | None, full_at: float) -> float:
    """value / full_at clipped to 0..1 (None counts 0)."""
    if value is None or not np.isfinite(value) or full_at <= 0:
        return 0.0
    return float(min(max(value / full_at, 0.0), 1.0))


def crossing_part(km2: float | None, min_km2: float, full_km2: float) -> float:
    """0 at min_km2, 1 at full_km2, on a log scale; 0 without a crossing."""
    if not km2 or km2 < min_km2:
        return 0.0
    return float(min(math.log10(km2 / min_km2) / math.log10(full_km2 / min_km2), 1.0))


def total(fig: dict, cfg: dict) -> tuple[float | None, dict]:
    """(score, parts) for a section's figures. None when neither the seasons nor the passes saw both
    sides: then the radar has nothing to say about this stretch."""
    sc = cfg["score"]
    if not fig["seasons_seen"] and fig["persistence"] is None:
        return None, {}
    damp = 1.0 if fig["upstream"] is not None else sc["unclear_upstream_factor"]
    parts = {
        "asymmetry": damp * part(fig["asymmetry"], sc["asymmetry"]["full_at"]),
        "seasons": damp * part(fig["seasons_up"] - fig["seasons_down"], sc["seasons"]["full_at"]),
        "persistence": damp * part(fig["persistence"], sc["persistence"]["full_at"]),
        "crossing": crossing_part(fig["crossing_km2"], cfg["crossings"]["min_catchment_km2"], sc["crossing"]["full_at_km2"]),
        "no_opening": 1.0 if fig["crossing_km2"] and not has_opening(fig["crossing_opening_m"], cfg) else 0.0,
    }
    score = sum(sc[k]["weight"] * v for k, v in parts.items())
    return round(score, 3), {k: round(v, 3) for k, v in parts.items()}


def classify(score: float | None, fig: dict, cfg: dict) -> str:
    c = cfg["classes"]
    if score is None:
        return NOT_SEEN
    # Some sign in the radar itself is needed for any class above "no sign": a crossing without a
    # mapped opening is only a question for the map, not evidence of held water.
    w = c["worth_a_look"]
    flood_sign = ((fig["asymmetry"] or 0) > 0 and (fig["asymmetry"] or 0) >= w["min_asymmetry"]) or (
        (fig["persistence"] or 0) > 0 and (fig["persistence"] or 0) >= w["min_persistence"])
    if score >= c["look_first"]["min_score"] and fig["seasons_up"] >= c["look_first"]["min_seasons_up"] and flood_sign:
        return LOOK_FIRST
    if score >= c["worth_a_look"]["min_score"] and flood_sign:
        return WORTH
    return NO_SIGN


def _passes(n: int) -> str:
    return f"{n} radar pass" if n == 1 else f"{n} radar passes"


def reasons(fig: dict, cfg: dict) -> list[str]:
    """The section's case in short plain sentences, strongest first."""
    out = []
    up = fig["upstream"]
    if fig["asymmetry"] is not None and fig["asymmetry"] > 0:
        side = f"the {SIDE_WORDS[up]} (upstream) side" if up is not None else "one side (upstream side unclear)"
        out.append(f"{side} was flooded on {100 * fig['asymmetry']:.0f} percentage points more of its land "
                   f"than the other, on average over {fig['seasons_seen']} seasons")
    if fig["seasons_up"]:
        out.append(f"upstream clearly wetter in {fig['seasons_up']} of {fig['seasons_seen']} seasons"
                   + (f" (downstream wetter in {fig['seasons_down']})" if fig["seasons_down"] else ""))
    if fig["persistence"] is not None and fig["persistence"] > 0 and fig["passes_up"] > fig["passes_down"]:
        out.append(f"water seen on the upstream side in {_passes(fig['passes_up'])}, on the other in "
                   f"{_passes(fig['passes_down'])} (of {fig['passes_seen']} that saw both)")
    if fig["crossing_km2"]:
        d = fig["crossing_opening_m"]
        if has_opening(d, cfg):
            where = f"a mapped {OPENING_WORDS.get(fig['crossing_opening'], fig['crossing_opening'])} {d:.0f} m away"
        else:
            where = f"no mapped bridge, culvert or waterway within {cfg['crossings']['opening_m']} m" + (
                f" (the nearest, a {OPENING_WORDS.get(fig['crossing_opening'], fig['crossing_opening'])}, is {d:.0f} m away)"
                if d is not None else "")
        out.append(f"natural drainage from {fig['crossing_km2']:.1f} km2 crosses the road here; {where}")
    if up is None:
        out.append("which side is upstream is unclear (flat land)")
    elif fig["upstream_agree"] is False:
        out.append("flow directions and ground height disagree on which side is upstream")
    return out
