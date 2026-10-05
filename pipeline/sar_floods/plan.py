"""From scene metadata to a plan: passes, reference per orbit, planned exports. Pure Python.

A "pass" is one overflight: the consecutive ~25 s slices that Earth Engine stores as separate images
but that share platform and absolute orbit. A pass is processed as one scene.

An "orbit" is a relative orbit plus pass direction, e.g. D091. The viewing geometry repeats exactly
on the same orbit, so the event pass and its dry reference always come from the same one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import naming, seasons
from .grid import Grid
from .settings import MAX_PASSES_PER_EVENT


@dataclass(frozen=True)
class Scene:
    id: str                 # system:index, e.g. S1A_IW_GRDH_1SDV_20241128T231805_..._ABCD
    time_ms: int            # system:time_start
    platform: str           # "A", "B", "C"
    relative_orbit: int     # relativeOrbitNumber_start
    absolute_orbit: int     # orbitNumber_start
    direction: str          # "ASCENDING" or "DESCENDING"
    bounds: tuple[float, float, float, float]   # lon/lat box of the footprint

    @property
    def orbit(self) -> str:
        return f"{self.direction[0]}{self.relative_orbit:03d}"


def scene_from_feature(feature: dict) -> Scene:
    """Build a Scene from one GeoJSON feature returned by ee_ops.list_scenes."""
    p = feature["properties"]
    xs, ys = [], []

    def walk(node):
        if isinstance(node[0], (int, float)):
            xs.append(node[0])
            ys.append(node[1])
        else:
            for child in node:
                walk(child)

    walk(feature["geometry"]["coordinates"])
    return Scene(id=p["id"], time_ms=int(p["time_start"]), platform=str(p["platform"]),
                 relative_orbit=int(p["relative_orbit"]), absolute_orbit=int(p["absolute_orbit"]),
                 direction=str(p["direction"]), bounds=(min(xs), min(ys), max(xs), max(ys)))


@dataclass
class Pass:
    scenes: list[Scene]
    status: str = "used"            # or "skipped"
    skip_reason: str | None = None
    thresholds: dict = field(default_factory=dict)   # filled by the run: {pol: {"summary", "tiles"}}

    @property
    def first(self) -> Scene:
        return self.scenes[0]

    @property
    def orbit(self) -> str:
        return self.first.orbit

    @property
    def pass_id(self) -> str:
        """20241128T2318Z_S1A_D091: UTC start time (as in the Sentinel product name), platform, orbit."""
        t = datetime.fromtimestamp(self.first.time_ms / 1000, timezone.utc)
        return f"{t:%Y%m%dT%H%MZ}_S1{self.first.platform}_{self.orbit}"

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        b = [s.bounds for s in self.scenes]
        return min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b)

    def as_dict(self) -> dict:
        out = {"pass_id": self.pass_id, "orbit": self.orbit, "platform": f"S1{self.first.platform}",
               "time_start_utc": seasons.iso_utc(self.first.time_ms), "scenes": [s.id for s in self.scenes],
               "status": self.status}
        if self.skip_reason:
            out["skip_reason"] = self.skip_reason
        if self.thresholds:
            out["thresholds"] = self.thresholds
        return out


def group_passes(scenes: list[Scene]) -> list[Pass]:
    """Group slices into passes (same platform and absolute orbit), ordered by time."""
    groups: dict[tuple[str, int], list[Scene]] = {}
    for s in scenes:
        groups.setdefault((s.platform, s.absolute_orbit), []).append(s)
    passes = [Pass(sorted(g, key=lambda s: s.time_ms)) for g in groups.values()]
    return sorted(passes, key=lambda p: (p.first.time_ms, p.first.platform))


def reference_by_orbit(scenes: list[Scene]) -> dict[str, dict]:
    """Per orbit: the reference scene ids and how many separate passes they come from."""
    out: dict[str, dict] = {}
    for p in group_passes(scenes):
        entry = out.setdefault(p.orbit, {"passes": 0, "scenes": []})
        entry["passes"] += 1
        entry["scenes"] += [s.id for s in p.scenes]
    return dict(sorted(out.items()))


@dataclass(frozen=True)
class Export:
    name: str               # Earth Engine task description = Drive file name without .tif
    kind: str               # "scene" or "max"
    grid: Grid
    bands: tuple[str, ...]
    pass_id: str | None = None

    def as_dict(self) -> dict:
        out = {"name": self.name, "kind": self.kind, "bands": list(self.bands), **self.grid.as_dict()}
        if self.pass_id:
            out["pass_id"] = self.pass_id
        return out


def apply_reference_rule(passes: list[Pass], reference: dict[str, dict], min_passes: int) -> None:
    """Mark passes whose orbit has too thin a dry reference as skipped. They are logged, not dropped
    silently: a skipped orbit means fewer valid observations, which the n_valid band shows."""
    for p in passes:
        have = reference.get(p.orbit, {}).get("passes", 0)
        if have < min_passes:
            p.status = "skipped"
            p.skip_reason = f"reference has {have} passes on orbit {p.orbit}, needs {min_passes}"


def planned_exports(event: seasons.Event, passes: list[Pass], master: Grid, params_hash: str) -> list[Export]:
    """One raster per used pass (priority events only) and one for the event."""
    used = [p for p in passes if p.status == "used"]
    if len(used) > MAX_PASSES_PER_EVENT:
        raise ValueError(f"{event.id} has {len(used)} passes; the 8-bit count bands hold at most "
                         f"{MAX_PASSES_PER_EVENT}. Shorten the event.")
    out = []
    if event.per_scene:
        for p in used:
            window = master.window(p.bounds)
            if window is not None:
                out.append(Export(naming.scene_name(p.pass_id, master.scale, params_hash), "scene",
                                  window, ("extent",), p.pass_id))
    if used:
        out.append(Export(naming.event_name(event.id, master.scale, params_hash), "max", master,
                          naming.EVENT_BANDS))
    return out
