# %% [markdown]
# # MobileDLC preliminary analysis
#
# This notebook-style script summarizes the current Colab DeepLabCut predictions without
# retraining or re-analyzing videos. It is intentionally conservative:
#
# - Uses existing prediction H5 files from the finished Colab run.
# - Keeps only the seven focus bodyparts.
# - Reports data-quality metrics before movement summaries.
# - Computes movement in pixel units only, unless FPS can be read from metadata.
# - Avoids arena-zone or behavioral claims until the arena is calibrated.
#
# In Colab, run this file cell-by-cell or paste the cells into a notebook.

# %%
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import math
import pickle
import re

import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import numpy as np
import pandas as pd
from IPython.display import display

try:
    from google.colab import drive
    drive.mount("/content/drive")
except Exception:
    pass

# %%
# Paths and analysis settings.
ROOT = Path("/content/drive/MyDrive/sp1DLC")
RUN = ROOT / "Colab_Training_Runs/mobile_fast_20260925_040943"
PREDICTIONS = RUN / "videos"

OUT = RUN / "Preliminary_Analysis" / datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
OUT.mkdir(parents=True, exist_ok=True)

FOCUS = ["nose", "left_ear", "right_ear", "spine_mid", "left_hip", "right_hip", "tail_base"]
TORSO = ["spine_mid", "left_hip", "right_hip", "tail_base"]

# Main cutoff should match the more inclusive visual review if Test 30 looks good.
LIKELIHOOD_CUTOFF = 0.20

# Fill only brief blink-outs. Longer gaps remain missing and are visible in QC.
MAX_INTERPOLATION_GAP_FRAMES = 6
SMOOTHING_WINDOW_FRAMES = 5

FIG_DPI = 180
plt.rcParams.update({
    "figure.dpi": FIG_DPI,
    "savefig.dpi": FIG_DPI,
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.18,
    "axes.facecolor": "#fbfbf8",
    "figure.facecolor": "white",
})

print("Prediction folder:", PREDICTIONS)
print("Output folder:", OUT)

# %%
def natural_key(path: Path) -> tuple:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name))


def h5_files() -> list[Path]:
    files = sorted(PREDICTIONS.glob("*snapshot_best-110.h5"), key=natural_key)
    assert files, f"No prediction H5 files found in {PREDICTIONS}"
    return files


def read_prediction(path: Path) -> pd.DataFrame:
    df = pd.read_hdf(path)
    assert isinstance(df.columns, pd.MultiIndex), f"{path.name} does not have DLC MultiIndex columns"
    levels = list(df.columns.names)
    assert "bodyparts" in levels and "coords" in levels, f"Unexpected DLC columns in {path.name}: {levels}"
    present = list(df.columns.get_level_values("bodyparts").unique())
    missing = [part for part in FOCUS if part not in present]
    assert not missing, f"{path.name} is missing focus bodyparts: {missing}"
    return df.loc[:, df.columns.get_level_values("bodyparts").isin(FOCUS)]


def read_fps(path: Path) -> float | None:
    meta_path = path.with_name(path.stem + "_meta.pickle")
    if not meta_path.exists():
        return None
    try:
        with meta_path.open("rb") as handle:
            meta = pickle.load(handle)
    except Exception:
        return None

    candidates = []
    stack = [meta]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key, value in item.items():
                if str(key).lower() in {"fps", "framerate", "frame_rate"}:
                    candidates.append(value)
                elif isinstance(value, (dict, list, tuple)):
                    stack.append(value)
        elif isinstance(item, (list, tuple)):
            stack.extend(item)

    for value in candidates:
        try:
            fps = float(value)
            if math.isfinite(fps) and fps > 0:
                return fps
        except Exception:
            continue
    return None


def get_coord(df: pd.DataFrame, bodypart: str, coord: str) -> pd.Series:
    cols = [
        col for col in df.columns
        if col[df.columns.names.index("bodyparts")] == bodypart
        and col[df.columns.names.index("coords")] == coord
    ]
    assert len(cols) == 1, f"Expected exactly one {bodypart}/{coord} column"
    return pd.to_numeric(df[cols[0]], errors="coerce")


def point_table(df: pd.DataFrame, cutoff: float) -> dict[str, pd.DataFrame]:
    out = {}
    for part in FOCUS:
        x = get_coord(df, part, "x")
        y = get_coord(df, part, "y")
        likelihood = get_coord(df, part, "likelihood")
        valid = likelihood >= cutoff
        out[part] = pd.DataFrame({
            "x": x.where(valid),
            "y": y.where(valid),
            "likelihood": likelihood,
            "valid": valid,
        })
    return out


def clean_series(series: pd.Series) -> pd.Series:
    filled = series.interpolate(limit=MAX_INTERPOLATION_GAP_FRAMES, limit_direction="both")
    if SMOOTHING_WINDOW_FRAMES > 1:
        filled = filled.rolling(SMOOTHING_WINDOW_FRAMES, center=True, min_periods=1).median()
    return filled


def body_center(points: dict[str, pd.DataFrame]) -> pd.DataFrame:
    x_cols = []
    y_cols = []
    for part in TORSO:
        x_cols.append(points[part]["x"].rename(part))
        y_cols.append(points[part]["y"].rename(part))

    x = pd.concat(x_cols, axis=1).mean(axis=1, skipna=True)
    y = pd.concat(y_cols, axis=1).mean(axis=1, skipna=True)
    valid_count = pd.concat([points[part]["valid"].rename(part) for part in TORSO], axis=1).sum(axis=1)

    center = pd.DataFrame({
        "x_raw": x,
        "y_raw": y,
        "valid_torso_points": valid_count,
    })
    center["x"] = clean_series(center["x_raw"])
    center["y"] = clean_series(center["y_raw"])
    center["usable"] = center[["x", "y"]].notna().all(axis=1)
    center["step_px"] = np.hypot(center["x"].diff(), center["y"].diff()).where(center["usable"])
    center.loc[~center["usable"], "step_px"] = np.nan
    return center


def summarize_video(path: Path, cutoff: float = LIKELIHOOD_CUTOFF) -> tuple[dict, pd.DataFrame, dict[str, pd.DataFrame]]:
    df = read_prediction(path)
    fps = read_fps(path)
    points = point_table(df, cutoff)
    center = body_center(points)

    frame_count = len(df)
    usable_center = float(center["usable"].mean() * 100)
    distance_px = float(center["step_px"].sum(skipna=True))
    median_step = float(center["step_px"].median(skipna=True))
    p95_step = float(center["step_px"].quantile(0.95))

    summary = {
        "video": path.name.partition("DLC_")[0],
        "frames": frame_count,
        "fps_from_metadata": fps,
        "likelihood_cutoff": cutoff,
        "usable_center_pct": usable_center,
        "total_distance_px": distance_px,
        "median_step_px_per_frame": median_step,
        "p95_step_px_per_frame": p95_step,
    }
    if fps:
        summary["duration_s"] = frame_count / fps
        summary["median_speed_px_s"] = median_step * fps
        summary["p95_speed_px_s"] = p95_step * fps
    else:
        summary["duration_s"] = np.nan
        summary["median_speed_px_s"] = np.nan
        summary["p95_speed_px_s"] = np.nan

    for part in FOCUS:
        summary[f"{part}_visible_pct"] = float(points[part]["valid"].mean() * 100)
        summary[f"{part}_median_likelihood"] = float(points[part]["likelihood"].median(skipna=True))

    return summary, center, points

# %%
files = h5_files()
print(f"Found {len(files)} prediction files")

summaries = []
centers = {}
all_points = {}
for path in files:
    summary, center, points = summarize_video(path)
    summaries.append(summary)
    centers[summary["video"]] = center
    all_points[summary["video"]] = points

summary_df = pd.DataFrame(summaries).sort_values("video", key=lambda s: s.map(lambda x: natural_key(Path(str(x)))))
summary_csv = OUT / "preliminary_summary.csv"
summary_df.to_csv(summary_csv, index=False)

print("Saved:", summary_csv)
display_cols = [
    "video", "frames", "usable_center_pct", "total_distance_px",
    "median_step_px_per_frame", "p95_step_px_per_frame",
]
display(summary_df[display_cols].round(2))

# %%
qc_rows = []
for _, row in summary_df.iterrows():
    for part in FOCUS:
        qc_rows.append({
            "video": row["video"],
            "bodypart": part,
            "visible_pct": row[f"{part}_visible_pct"],
            "median_likelihood": row[f"{part}_median_likelihood"],
        })
qc_df = pd.DataFrame(qc_rows)
qc_csv = OUT / "bodypart_qc.csv"
qc_df.to_csv(qc_csv, index=False)
print("Saved:", qc_csv)

# %%
def save_bar(values: pd.Series, title: str, ylabel: str, filename: str, color: str = "#386c5f") -> None:
    fig_h = max(5.5, 0.22 * len(values) + 2.0)
    fig, ax = plt.subplots(figsize=(9, fig_h))
    ordered = values.sort_values()
    ax.barh(ordered.index, ordered.values, color=color, alpha=0.88)
    ax.set_title(title, loc="left", fontsize=14, weight="bold")
    ax.set_xlabel(ylabel)
    ax.set_ylabel("")
    fig.tight_layout()
    fig.savefig(OUT / filename, bbox_inches="tight")
    plt.show()


save_bar(
    summary_df.set_index("video")["usable_center_pct"],
    "Tracking coverage by video",
    f"Body-center frames usable at likelihood >= {LIKELIHOOD_CUTOFF}",
    "tracking_coverage_by_video.png",
    "#2f6f73",
)

save_bar(
    summary_df.set_index("video")["total_distance_px"],
    "Pixel distance by video",
    "Total body-center path length, pixels",
    "distance_by_video.png",
    "#6f5d2f",
)

save_bar(
    summary_df.set_index("video")["median_step_px_per_frame"],
    "Typical frame-to-frame movement",
    "Median body-center step, pixels/frame",
    "median_step_by_video.png",
    "#654b7c",
)

# %%
qc_heat = qc_df.pivot(index="video", columns="bodypart", values="visible_pct")
qc_heat = qc_heat.loc[summary_df["video"], FOCUS]

fig, ax = plt.subplots(figsize=(10.5, max(6, 0.24 * len(qc_heat) + 1.6)))
image = ax.imshow(qc_heat.values, aspect="auto", vmin=0, vmax=100, cmap="viridis")
ax.set_title("Bodypart visibility", loc="left", fontsize=14, weight="bold")
ax.set_xticks(np.arange(len(FOCUS)))
ax.set_xticklabels(FOCUS, rotation=35, ha="right")
ax.set_yticks(np.arange(len(qc_heat.index)))
ax.set_yticklabels(qc_heat.index)
for row in range(qc_heat.shape[0]):
    for col in range(qc_heat.shape[1]):
        value = qc_heat.iat[row, col]
        ax.text(col, row, f"{value:.0f}", ha="center", va="center",
                color="white" if value < 65 else "#14201e", fontsize=7)
cbar = fig.colorbar(image, ax=ax, fraction=0.025, pad=0.02)
cbar.set_label("% frames at/above cutoff")
fig.tight_layout()
fig.savefig(OUT / "bodypart_visibility_heatmap.png", bbox_inches="tight")
plt.show()

# %%
def plot_track(video: str, center: pd.DataFrame, pdf: PdfPages | None = None) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), gridspec_kw={"width_ratios": [1.0, 1.2]})
    ax = axes[0]
    ok = center["usable"]
    if ok.any():
        ax.plot(center.loc[ok, "x"], center.loc[ok, "y"], color="#2f6f73", lw=1.1, alpha=0.85)
        ax.scatter(center.loc[ok, "x"].iloc[:1], center.loc[ok, "y"].iloc[:1], s=38, color="#1b4332", label="start", zorder=3)
        ax.scatter(center.loc[ok, "x"].iloc[-1:], center.loc[ok, "y"].iloc[-1:], s=38, color="#b84a3a", label="end", zorder=3)
    else:
        ax.text(0.5, 0.5, "No usable body-center frames", ha="center", va="center", transform=ax.transAxes)
    ax.invert_yaxis()
    ax.set_aspect("equal", adjustable="box")
    ax.set_title(f"{video}: body-center track", loc="left", weight="bold")
    ax.set_xlabel("x pixel")
    ax.set_ylabel("y pixel")
    ax.legend(frameon=False, fontsize=8)

    ax = axes[1]
    ax.plot(center.index, center["step_px"], color="#654b7c", lw=0.85, alpha=0.85)
    ax.set_title("Frame-to-frame movement", loc="left", weight="bold")
    ax.set_xlabel("Frame")
    ax.set_ylabel("Pixels/frame")
    y95 = center["step_px"].quantile(0.95)
    if math.isfinite(y95):
        ax.axhline(y95, color="#b84a3a", ls="--", lw=1, alpha=0.75, label="95th percentile")
        ax.legend(frameon=False, fontsize=8)

    fig.tight_layout()
    if pdf:
        pdf.savefig(fig, bbox_inches="tight")
    plt.show()


track_pdf = OUT / "body_center_tracks.pdf"
with PdfPages(track_pdf) as pdf:
    for video in summary_df["video"]:
        plot_track(video, centers[video], pdf=pdf)
print("Saved:", track_pdf)

# %%
# Conservative outlier list for manual visual review, not automatic exclusion.
review = summary_df[[
    "video",
    "usable_center_pct",
    "total_distance_px",
    "median_step_px_per_frame",
    "p95_step_px_per_frame",
]].copy()

review["review_reason"] = ""
low_coverage = review["usable_center_pct"] < 90
high_jump = review["p95_step_px_per_frame"] > review["p95_step_px_per_frame"].median() * 2
review.loc[low_coverage, "review_reason"] += "lower tracking coverage; "
review.loc[high_jump, "review_reason"] += "larger high-percentile jumps; "
review = review[review["review_reason"].str.len() > 0]

review_csv = OUT / "manual_review_flags.csv"
review.to_csv(review_csv, index=False)
print("Saved:", review_csv)
display(review.round(2))

# %%
report = OUT / "preliminary_report.md"
best = summary_df["usable_center_pct"].median()
distance_median = summary_df["total_distance_px"].median()
with report.open("w", encoding="utf-8") as handle:
    handle.write("# MobileDLC preliminary analysis report\n\n")
    handle.write(f"Generated: {datetime.now(timezone.utc).isoformat()}\n\n")
    handle.write(f"Run folder: `{RUN}`\n\n")
    handle.write("## Scope\n\n")
    handle.write(
        "This analysis uses existing DeepLabCut prediction H5 files from the completed "
        "Colab run. It does not retrain the model or re-run video inference. Movement "
        "is summarized in pixel units using a smoothed torso/body-center estimate.\n\n"
    )
    handle.write("## Settings\n\n")
    handle.write(f"- Focus bodyparts: {', '.join(FOCUS)}\n")
    handle.write(f"- Likelihood cutoff: {LIKELIHOOD_CUTOFF}\n")
    handle.write(f"- Short-gap interpolation limit: {MAX_INTERPOLATION_GAP_FRAMES} frames\n")
    handle.write(f"- Smoothing window: {SMOOTHING_WINDOW_FRAMES} frames\n\n")
    handle.write("## Conservative interpretation\n\n")
    handle.write(
        "Use these outputs as preliminary quality-control and movement summaries. "
        "They are appropriate for showing that the pipeline produces coherent tracks "
        "and for selecting videos that need visual review. Avoid claims about arena "
        "zones, anxiety-like behavior, or absolute distance until arena calibration "
        "and scale conversion are added.\n\n"
    )
    handle.write("## Headline QC\n\n")
    handle.write(f"- Videos analyzed: {len(summary_df)}\n")
    handle.write(f"- Median usable body-center coverage: {best:.1f}% of frames\n")
    handle.write(f"- Median total path length: {distance_median:.1f} pixels\n")
    handle.write(f"- Videos flagged for manual review: {len(review)}\n\n")
    handle.write("## Files\n\n")
    for name in [
        "preliminary_summary.csv",
        "bodypart_qc.csv",
        "manual_review_flags.csv",
        "tracking_coverage_by_video.png",
        "distance_by_video.png",
        "median_step_by_video.png",
        "bodypart_visibility_heatmap.png",
        "body_center_tracks.pdf",
    ]:
        handle.write(f"- `{name}`\n")

print("Saved:", report)
print("Analysis complete. Output folder:", OUT)
