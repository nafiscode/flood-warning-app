"""The outlook itself: which methods may be used this time, what they say, and the one line to read
first. Pure functions over the results of `history` and `models`."""

from __future__ import annotations

NAMES = ("dry", "normal", "wet")


def in_range(value: float, past: list[float], edge: int = 1) -> bool:
    """False when this year's forecast lies beyond (or within `edge` of the end of) everything the
    model forecast in its past seasons: then its real-time runs are not comparable with the runs
    it was scored on, and its lean says more about the model than about the season."""
    below = sum(v < value for v in past)
    return edge <= below <= len(past) - edge


def mean_odds(blocks: list[dict]) -> dict[str, int]:
    """Average odds over several records, rounded so they add to 100."""
    raw = {k: sum(b[k] for b in blocks) / len(blocks) for k in NAMES}
    out = {k: int(round(v)) for k, v in raw.items()}
    out["normal"] += 100 - sum(out.values())
    return out


def enso_odds(by_phase: dict, phase: str) -> dict[str, int]:
    """Odds of each third after a Pacific in this phase, from the record, one season added to each
    third so nine seasons never read as certainty."""
    p = by_phase[phase]
    wet, dry = p["wet_third"], p["dry_third"]
    normal = p["seasons"] - wet - dry
    total = p["seasons"] + 3
    return {"dry": round(100 * (dry + 1) / total), "normal": round(100 * (normal + 1) / total),
            "wet": round(100 * (wet + 1) / total)}


def beats(entry: dict, baselines: list[dict]) -> bool:
    return all(entry["hit_rate_pct"] > b["hit_rate_pct"] for b in baselines)


def summary(rows: list[dict]) -> tuple[str, str]:
    """The line to read first: a lean only when every usable method leans the same way."""
    leans = {r["lean"] for r in rows if r["usable"] and r["lean"] != "none"}
    if len(leans) == 1:
        lean = leans.pop()
        return lean, f"The usable methods agree: a {lean} lean. Weak skill; readiness stays as for any season."
    if not leans:
        return "none", "No method can be trusted this time. Prepare as for any season."
    return "none", ("The usable methods disagree (" + ", ".join(sorted(leans)) +
                    "). No reliable lean. Prepare as for any season.")
