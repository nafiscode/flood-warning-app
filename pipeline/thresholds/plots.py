"""One figure per flood at a zone's key gauge: what the signals did in the days before it.

Three panels on one time axis (Bangkok time), five days before the onset to three days after:

  1. the key gauge's level with its Watch, Warning and Evacuate (bank) lines;
  2. the upstream gauge's level with its own three lines;
  3. hourly basin rain (satellite) as bars, its 72-hour total as a line with the zone's Watch
     threshold, and, from 2024, the 72 hours ahead as the default forecast model saw them three
     days before.

The onset is marked on every panel. Output: <output_dir>/plots/<zone>_<YYYY-MM-DD>.png and one
contact sheet per zone.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from . import forecast as fc  # noqa: E402
from . import hindcast as hc  # noqa: E402

BKK = "Asia/Bangkok"
LEVEL_STYLE = {"watch": ("#b8860b", "Watch"), "warning": ("#d2691e", "Warning"), "evacuate": ("#b22222", "Evacuate (bank)")}
WATER = "#1b6e8c"


def levels_of(gauge_levels: list[dict], code: str, bank: float) -> dict:
    row = next((r for r in gauge_levels if r.get("code") == code), {})
    out = {k: row.get(k) for k in ("watch", "warning", "evacuate")}
    out["evacuate"] = out["evacuate"] if out["evacuate"] is not None else bank
    return out


def _level_panel(ax, series: pd.Series, levels: dict, title: str) -> None:
    if not series.dropna().empty:
        ax.plot(series.index, series.to_numpy(), color=WATER, lw=1.6)
    values = [v for v in levels.values() if v is not None] + list(series.dropna().to_numpy())
    if values:
        pad = (max(values) - min(values)) * 0.06 or 0.5
        ax.set_ylim(min(values) - pad, max(values) + pad)
    shown = [(k, v) for k, v in levels.items() if v is not None]
    for key, value in shown:
        ax.axhline(value, color=LEVEL_STYLE[key][0], lw=1, ls="--")
    # The names beside the lines, pushed apart where the levels sit close together.
    lo, hi = ax.get_ylim()
    spots, last = [], None
    for key, value in sorted(shown, key=lambda kv: kv[1]):
        y = (value - lo) / (hi - lo)
        y = y if last is None else max(y, last + 0.06)
        spots.append((key, value, y))
        last = y
    for key, value, y in spots:
        color, name = LEVEL_STYLE[key]
        ax.text(1.0, y, f" {name} {value:.2f}", transform=ax.transAxes, color=color,
                va="center", ha="left", fontsize=8, clip_on=False)
    ax.set_ylabel("m MSL")
    ax.set_title(title, loc="left", fontsize=10)
    ax.grid(alpha=0.25)


def flood_figure(zone_name: str, onset: pd.Timestamp, key: tuple[str, pd.Series, dict],
                 upstream: tuple[str, pd.Series, dict], rain: pd.Series, watch_mm: float | None,
                 forecast_ahead: pd.Series | None, path: Path) -> None:
    start, end = onset - pd.Timedelta(days=5), onset + pd.Timedelta(days=3)
    cut = lambda s: s[start:end].tz_convert(BKK) if not s.empty else s  # noqa: E731
    fig, axes = plt.subplots(3, 1, figsize=(10, 8.5), sharex=True, gridspec_kw={"height_ratios": [3, 2, 2.4]})
    _level_panel(axes[0], cut(key[1]), key[2], f"Key gauge {key[0]}")
    _level_panel(axes[1], cut(upstream[1]), upstream[2], f"Upstream gauge {upstream[0]}")
    r = cut(rain)
    ax = axes[2]
    if not r.empty:
        ax.bar(r.index, r.to_numpy(), width=1 / 24, color="#7aa6c2", label="rain per hour (satellite)")
        ax2 = ax.twinx()
        ax2.plot(r.index, cut(hc.rolling_sum(rain, 72)).to_numpy(), color="#33444f", lw=1.4, label="last 72 h")
        if forecast_ahead is not None and not forecast_ahead.empty:
            f = cut(forecast_ahead)
            ax2.plot(f.index, f.to_numpy(), color="#7b3fa0", lw=1.2, ls=":", label="next 72 h, forecast 3 days old")
        if watch_mm is not None:
            ax2.axhline(watch_mm, color=LEVEL_STYLE["watch"][0], lw=1, ls="--")
            ax2.text(0.99, watch_mm, f"Watch {watch_mm:g} mm", transform=ax2.get_yaxis_transform(),
                     color=LEVEL_STYLE["watch"][0], va="bottom", ha="right", fontsize=8)
        ax2.set_ylabel("mm in 72 h")
        ax2.legend(loc="upper left", fontsize=8, frameon=False)
    ax.set_ylabel("mm / h")
    ax.set_title("Basin rain", loc="left", fontsize=10)
    ax.grid(alpha=0.25)
    for a in axes:
        a.axvline(onset.tz_convert(BKK), color="#b22222", lw=1)
    axes[0].text(onset.tz_convert(BKK), 1.02, " onset (over the bank)", transform=axes[0].get_xaxis_transform(),
                 color="#b22222", fontsize=8)
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter("%d %b\n%H:%M", tz=BKK))
    fig.suptitle(f"{zone_name}: flood of {onset.tz_convert(BKK):%d %b %Y} (Bangkok time)", x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0, 0.9, 1))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)


def contact_sheet(paths: list[Path], path: Path, columns: int = 3) -> None:
    """All of a zone's flood figures on one page, small."""
    import matplotlib.image as mpimg

    if not paths:
        return
    rows = -(-len(paths) // columns)
    fig, axes = plt.subplots(rows, columns, figsize=(columns * 5, rows * 4.2))
    for ax in list(getattr(axes, "flat", [axes])):
        ax.axis("off")
    for ax, p in zip(getattr(axes, "flat", [axes]), paths):
        ax.imshow(mpimg.imread(p))
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def run(cfg: dict, out: Path, tidy: Path, rain: pd.DataFrame, read_gauge) -> dict:
    result = json.loads((out / "hindcast.json").read_text(encoding="utf-8"))
    gauge_levels = json.loads((out / "gauge_levels.json").read_text(encoding="utf-8")) if (out / "gauge_levels.json").exists() else []
    written: dict[str, list[str]] = {}
    for zone, z in cfg["zones"].items():
        zres = result["zones"][zone]
        key, up = z["key"], z["upstream"]
        key_s, up_s = read_gauge(tidy, key), read_gauge(tidy, up)
        column = f"{zone}.{z['rain_basin']}"
        basin = rain[column] if column in rain else pd.Series(dtype=float)
        watch = (zres["proposal"].get("watch") or {})
        watch_mm = float(watch["threshold"]) if watch.get("signal") == "rain_72h_mm" else None
        frames = sorted((out / "forecast" / zone).glob("best_match_*.parquet"))
        ahead = fc.ahead(pd.concat(pd.read_parquet(f) for f in frames).sort_index()["day3"]) if frames else None
        paths = []
        for f in zres["floods"]:
            onset = pd.Timestamp(f["onset"])
            path = out / "plots" / f"{zone}_{onset:%Y-%m-%d}.png"
            flood_figure(z["name"]["en"], onset,
                         (key["code"], key_s, levels_of(gauge_levels, key["code"], float(key["bank_m"]))),
                         (up["code"], up_s, levels_of(gauge_levels, up["code"], float(up["bank_m"]))),
                         basin, watch_mm, ahead, path)
            paths.append(path)
        contact_sheet(paths, out / "plots" / f"{zone}_all.png")
        written[zone] = [p.name for p in paths]
    return written
