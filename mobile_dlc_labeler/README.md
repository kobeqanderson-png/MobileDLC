# Mobile DLC Labeler

The Windows launcher opens `C:\Users\kobeq\Documents\checking protocol\sp1DLC`, including every image in its `labeled-data` Test folders. It currently contains 1,865 frames across 31 folders. The editor reads the original images and H5 annotations there, while saving its own edits and exports in `full_project_state` beside `app.py`. New extracted frames appear after restarting the labeler.

## Start

Unzip the archive on the laptop. Install the requirements once from a terminal inside `mobile_dlc_labeler`:

```bash
python -m pip install -r requirements.txt
```

Then double-click `Start_Labeler.bat` on Windows. A launch screen opens automatically on the laptop with a QR code. Scan it from a phone on the **same Wi-Fi**; it opens the full project. Keep the terminal window running while labeling. If the launch screen does not open, use its URL printed in the terminal. The editor opens the first frame that still needs a focus point. Use the Test-folder menu to jump between folders, or the frame slider to jump within the full set.

The full-project Windows launcher starts at port 8877 and uses the next free port if needed. Older tabs on port 8765 may still show the 40-frame pilot; close those tabs and use the new launch screen, which should say `sp1DLC`, `1865 frames`, and `31 Test folders`. Scan the QR code from that screen. Keep `full_project_state` when updating the app; it contains your saved edits.

The bundled 40-frame `real_pilot` remains available with `python app.py real_pilot --schema focus7` for reference. To run a different project, use `python app.py "/path/to/project" --schema focus7 --state-dir "/path/to/labeler-state"`. The Windows launcher uses the local `sp1DLC` path above each time; change its `PROJECT` line if that project moves.

## The seven points

| Phone label | Original DLC bodypart |
| --- | --- |
| Nose | `nose` |
| Left ear | `left_ear` |
| Right ear | `right_ear` |
| Mid spine | `spine_mid` |
| Left lateral | `left_hip` |
| Right lateral | `right_hip` |
| Tail base | `tail_base` |

The lateral-to-hip equivalence is the user's definition for this project. All seven already have labels in the existing 19-point dataset. This is a **focus view**, not a change to the trained model or `config.yaml`; no retraining is needed to use these seven existing predictions. The other 12 labels and their coordinates stay in the exported 19-point H5 even though the phone does not show them.

The active point has a bright outline and a name badge. Select a point in the panel, drag its dot to correct it, or drag empty image space to pan. Pinch with two fingers, use the zoom buttons, or use a mouse wheel to zoom. **Place point** lets you tap once to set a missing point, then returns to Move / pan. **Select several** toggles points for deletion. Previous/Next moves through all extracted frames. The active point and zoom carry forward; **Fit image** resets the view. Undo/redo applies to the current frame. Marker size, shape, and color stay set across frames and browser reloads on that device; they affect display only.

The editor keeps the frame image and its controls together. The Test-folder menu and frame slider jump through the full project. On a phone, the body-point list scrolls horizontally below the image; tapping a missing point selects Place mode, while tapping a placed point selects Move mode. The worklist shows progress for the current animal and frame. **Next missing point** selects the next unfinished body point, and **Next incomplete frame** scans forward through the project.

## Save and verify

Each edit is saved on the laptop in `full_project_state/annotations-focus7.sqlite3`. The four existing pilot edits were copied into that journal. **Export DLC H5 + CSV** creates copies under `full_project_state/export/labeled-data/<Test folder>/`. It changes only the bodypoints you actually edit, leaving all other coordinates, image indices, and the original H5 intact.

Before updating your working DLC project, compare an edited point in the exported copy with the original, then open a copy of the exported folder in napari. Once confirmed, put the exported `CollectedData_Kobe.h5` and CSV into the corresponding `labeled-data/<Test folder>` of your DLC project. The labeler does not write to the source project.

The real-data round trip was checked on the supplied 40-frame H5: a ten-pixel nose edit changed one coordinate; the other 19-point columns, all frame indices, and the original H5 remained unchanged. The user also completed a phone-to-export-to-napari round trip.

## Other projects

For the full bodypart list in any single-animal DLC project, run `python app.py "/path/to/project" --schema project`. An older three-frame preview is included as `demo`; it comes from a video with dots baked into the pixels, so its export is disabled. For a genuinely seven-point DLC project whose bodypart names match that older preset, use `--schema simba7`. The focus view is for your current 19-point project. The Windows launcher uses `focus7`; choose the other schemas explicitly from a terminal. The macOS/Linux `Start_Labeler.sh` still opens the bundled pilot unless given a project path explicitly.

This version has no HTTPS or multi-user authentication; use the private URL on a trusted local network. It does not extract new frames or import machine predictions. If the source H5 changes on disk while the server is running, restart and recheck the export.
