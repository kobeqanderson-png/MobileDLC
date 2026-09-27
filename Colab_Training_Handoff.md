# sp1DLC Colab handoff

## Current task: seven-point videos

Training is complete. Open the one current notebook, [Colab_Render_Seven_Points.ipynb](https://colab.research.google.com/drive/1TsxXMG1wqzcCITLt9lqkWtCJPrHjsf7a). If DeepLabCut is already installed in the current Colab runtime, skip the install cell. Run **prepare**, then the sample cell. The sample currently renders `Test 30.mp4` at `pcutoff=0.2` and saves a `_p20_labeled.mp4` for comparison with the current `_p30` video. Inspect the sample before changing the full batch cell. No GPU or retraining is needed for this step.

The notebook reuses the finished run's predictions, so it does not retrain or analyze the videos again. During setup it makes temporary H5 copies that physically keep only `nose`, `left_ear`, `right_ear`, `spine_mid`, `left_hip`, `right_hip`, and `tail_base`; this prevents old 19-point columns from leaking into the render. It draws those seven points with a skeleton connecting them. There are no trails. The current sensitivity test uses a 0.2 display cutoff on Test 30; the full batch cell still uses 0.3 until the sample is approved. New labeled MP4s go to `MyDrive/sp1DLC/Colab_Training_Runs/mobile_fast_20260925_040943/Seven_Point_Videos/`; existing `_p50_labeled.mp4` videos and original 19-point prediction H5 files remain unchanged.

Why the old Test 11 skeleton looked incomplete: its saved prediction CSV has all seven coordinates on all 1,201 frames, but only 69 frames have all seven likelihoods at or above 0.5. At 0.3, 1,057 frames have all seven points above the cutoff; this changes visibility, not model confidence. At 24, 56, 72, and 104 seconds the lower-confidence points follow the rat when shown at 0.1. The older dot-only [Test 11 0.1 render](https://drive.google.com/file/d/1NgrJAzF6NmnpXgQMJ3V3PFP4xpiT42gg/view) is available for comparison.

The notebook and original video archive layout were checked locally, but the seven-point renders have not been run in your Colab session here. If a cell fails, keep the full traceback and report which cell failed.

## Preliminary analysis

Use `Colab_Preliminary_Analysis.ipynb` for the first conservative analysis pass. It reads the existing prediction H5 files from the completed run, keeps the seven focus bodyparts, and writes outputs under `MyDrive/sp1DLC/Colab_Training_Runs/mobile_fast_20260925_040943/Preliminary_Analysis/<timestamp>/`. It produces QC tables, visibility heatmaps, body-center tracks, pixel-distance summaries, and a short Markdown report. Treat these as preliminary pixel-space movement and tracking-quality summaries only; do not make arena-zone or absolute-distance claims until calibration is added.

## Expanded-label retraining

A fresh live label export was pulled on September 27, 2026 after the work-session labels were added. Compared with the September 24 frozen training export, the sp1DLC set increased from 5,128 to 6,902 placed seven-point labels and from 608 to 883 complete seven-point frames. The converted DLC labels were written locally under `independent_labeler/imports/work-labels-dlc-20260927-165542/`.

The expanded-label model finished training in `MyDrive/sp1DLC/Colab_Training_Runs/mobile_worklabels_20260927_210240/`. It kept `snapshot-best-110.pt` as the best checkpoint. Evaluation finished with test RMSE `2.06 px` and test mAP `89.39` on this run's split. This is slightly below the baseline's `91.46` test mAP, so treat it as a visual/dropout candidate rather than an automatic replacement until labeled videos are compared on the problem clips. The baseline `mobile_fast_20260925_040943` run remains untouched.

Next step: run `Colab_Worklabels_Videos.ipynb` to create prediction H5 files and seven-point `_p20_labeled.mp4` videos from `mobile_worklabels_20260927_210240`. It writes videos to `MyDrive/sp1DLC/Colab_Training_Runs/mobile_worklabels_20260927_210240/Seven_Point_Videos_p20/`.

After the videos/predictions exist, run `Colab_Worklabels_Tracking_Behavior_Analysis.ipynb`. It writes tracking QC and preliminary behavior outputs under `MyDrive/sp1DLC/Colab_Training_Runs/mobile_worklabels_20260927_210240/Tracking_Behavior_Analysis/<timestamp>/`. The behavior layer is locomotor/activity behavior only: total body-center distance, active/rest frame percentages, movement bouts, and per-video trajectory pages. It does not make arena-zone or calibrated-distance claims yet.

## Baseline model

- Drive run: [mobile_fast_20260925_040943](https://drive.google.com/drive/folders/1Na497DJV6WQPQLKQ2e5T89n3xvfH8xf1).
- The 19-point ResNet50 run completed 200 epochs. Its saved best checkpoint is epoch 110, with 91.46 test mAP on this run's split. The video notebook uses that checkpoint.
- Keep this run and its epoch-110 checkpoint unchanged as the baseline. Later experiments should use a new run folder so results can be compared with it.
- The run already contains H5 predictions for 31 Test videos. The 19-point overlays in its `videos` folder are retained for reference.
- The training labels were frozen from the website on September 24, 2026 at 11:01 PM Eastern. Labels added later are not in this model.
- The previous model's 90.17 test mAP and 1.79 px test RMSE came from a different test split; those numbers are not a direct before/after comparison.

## Where things live

- [Colab export folder](https://drive.google.com/drive/folders/1yZJFeih1IRt7S6vamkQUEqLSn5UgsZft): current video notebook, this guide, frozen label backup, and training input archive pieces.
- [Archived training notebooks](https://drive.google.com/drive/folders/10OAScExSmltajSdCx-F_HzgWyLeRESLW): the three older training notebooks, kept for history but not needed to make videos. Local copies are in `archive/colab_notebooks/`.
- [Frozen JSON label backup](independent_labeler/imports/colab-labels-20260924-230130.json) and [prepared training ZIP](independent_labeler/imports/sp1DLC_colab_ready_20260924.zip): local copies. The ZIP is stored in nine numbered pieces in Drive due to a large-file upload limit.
- Original raw videos are in `MyDrive/sp1DLC/all_32_videos.zip`. The video notebook selects the 31 Test videos with matching predictions.

## Later retraining

Keep labeling the frames already in MobileDLC whenever convenient. Those edits are saved on the site but do not change the baseline model automatically. When you want to include them, download a fresh label snapshot, convert it with `independent_labeler/import_hosted.py`, and train in a new run folder. Do not rerun the archived notebook against the old September 24 ZIP and expect newer labels to appear.

The live labeler now includes 640 unlabeled EPM frames alongside the original 1,865 sp1DLC frames. EPM labels are not in the baseline model or its training archive. The OFPO source files are `.szv` recordings and are not yet in the labeler; readable MP4 exports are needed before frames can be sampled. Keep the baseline run for comparison when retraining across paradigms.
