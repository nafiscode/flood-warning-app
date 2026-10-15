"""PNG figures of the top sections: the radar's flood frequency around the road, the two strips that
were compared, the drainage crossing and the mapped openings. For a look, not for publication."""

from __future__ import annotations

from pathlib import Path

import numpy as np

INK = "#1D3B53"            # Jaga's ink; the road
MUTED = "#6B7A86"
OPEN_MARKS = {"bridge": ("s", "bridge"), "culvert": ("o", "culvert"), "waterway": ("D", "mapped waterway")}


def draw(rows: list[dict], dest: Path, freq_path: Path, openings: list[tuple[float, float, str]], cfg: dict, to_xy) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import rasterio
    from matplotlib.colors import ListedColormap
    from rasterio.windows import from_bounds

    dest.mkdir(parents=True, exist_ok=True)
    sd = cfg["sides"]
    ox, oy = (to_xy(np.array([o[0] for o in openings]), np.array([o[1] for o in openings]))
              if openings else (np.zeros(0), np.zeros(0)))
    okind = np.array([o[2] for o in openings])
    blues = ListedColormap(plt.get_cmap("Blues")(np.linspace(0.08, 1.0, 256)))
    blues.set_bad("#D9D9D9")
    names = []
    with rasterio.open(freq_path) as src:
        for k, r in enumerate(rows, start=1):
            x, y = to_xy(np.array(r["lon"]), np.array(r["lat"]))
            xy = np.column_stack([x, y])
            pad = sd["far_m"] + 400
            box = (x.min() - pad, y.min() - pad, x.max() + pad, y.max() + pad)
            win = from_bounds(*box, transform=src.transform).round_offsets().round_lengths()
            freq = src.read(1, window=win, boundless=True, fill_value=-1).astype("float64")
            freq[freq < 0] = np.nan
            wt = src.window_transform(win)
            extent = (wt.c, wt.c + wt.a * freq.shape[1], wt.f + wt.e * freq.shape[0], wt.f)
            fig, ax = plt.subplots(figsize=(7.2, 6.4), dpi=130)
            im = ax.imshow(freq, extent=extent, cmap=blues, vmin=0, vmax=max(0.2, np.nanmax(freq) if np.isfinite(freq).any() else 0.2),
                           interpolation="nearest")
            cb = fig.colorbar(im, ax=ax, shrink=0.7)
            cb.set_label("share of radar passes flooded, 2017-2025 (grey: never seen)", color=MUTED, fontsize=8)
            cb.ax.tick_params(labelsize=7, colors=MUTED)
            # The strips: lines at near_m and far_m on each side, the upstream one solid.
            d = np.diff(xy, axis=0)
            t = d / np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]
            t = np.vstack([t, t[-1:]])
            n = np.column_stack([-t[:, 1], t[:, 0]])
            up = {"left": 0, "right": 1}.get(r["upstream_side"])
            for side, sign in ((0, 1.0), (1, -1.0)):
                style = "-" if side == up else "--"
                label = ("upstream side" if side == up else "downstream side") if up is not None else f"{'left' if side == 0 else 'right'} side"
                for dist, lab in ((sd["near_m"], None), (sd["far_m"], label)):
                    off = xy + sign * dist * n
                    ax.plot(off[:, 0], off[:, 1], style, color=MUTED, lw=1.0, label=lab)
            ax.plot(x, y, "-", color=INK, lw=2.5, label=f"{r['highway']} {r['ref'] or ''}".strip(), solid_capstyle="round")
            near = (ox >= box[0]) & (ox <= box[2]) & (oy >= box[1]) & (oy <= box[3])
            for kind, (marker, lab) in OPEN_MARKS.items():
                sel = near & (okind == kind)
                if sel.any():
                    ax.plot(ox[sel], oy[sel], marker, ms=8, mfc="white", mec=INK, mew=1.5, ls="none", label=f"mapped {lab}")
            if r["crossing_lon"] is not None:
                cx, cy = to_xy(np.array([r["crossing_lon"]]), np.array([r["crossing_lat"]]))
                ax.plot(cx, cy, "^", ms=10, mfc="#E0679E", mec=INK, mew=1.2, ls="none",
                        label=f"drainage crossing, {r['crossing_km2']:.1f} km2")
            ax.set_xlim(box[0], box[2])
            ax.set_ylim(box[1], box[3])
            ax.set_aspect("equal")
            ax.set_xticks([])
            ax.set_yticks([])
            for s in ax.spines.values():
                s.set_color("#C8CDD2")
            ax.set_title(f"{r['id']}  {r['tambon_en']}, {r['district_en']}, {r['province_en']}\n"
                         f"{r['class'].replace('_', ' ')}, score {r['score']:.2f}; asymmetry {r['asymmetry']}; "
                         f"seasons up/down wetter {r['seasons_up_wetter']}/{r['seasons_down_wetter']}",
                         fontsize=9, color=INK, loc="left")
            ax.legend(loc="lower left", fontsize=7, frameon=True, framealpha=0.9)
            ax.text(1.0, -0.02, f"{(box[2] - box[0]) / 1000:.1f} x {(box[3] - box[1]) / 1000:.1f} km; UTM 47N. Radar: Sentinel-1 (Jaga S2). Roads: (c) OpenStreetMap.",
                    transform=ax.transAxes, ha="right", va="top", fontsize=6.5, color=MUTED)
            name = f"{k:02d}_{r['id']}_{r['province_en'].lower()}.png"
            fig.savefig(dest / name, bbox_inches="tight")
            plt.close(fig)
            names.append(f"out/{cfg['output_dir'].split('/', 1)[1]}/figures/{name}")
    return names
