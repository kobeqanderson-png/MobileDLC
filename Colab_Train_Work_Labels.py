# %% [markdown]
# # Train sp1DLC with expanded work-label export
#
# Use this notebook after selecting **Runtime > Change runtime type > GPU**.
#
# This starts a new run from the fresh hosted-label export pulled on September 27,
# 2026. It does not overwrite the baseline run. The prepared ZIP contains the same
# source project/images as the baseline, with freshly converted seven-point H5/CSV
# label tables overlaid from the live labeler.

# %%
%pip -q install --pre deeplabcut

# %%
from google.colab import drive
drive.mount('/content/drive')

from datetime import datetime, timezone
from pathlib import Path
import json
import shutil
import zipfile

import deeplabcut
import pandas as pd
import torch
import yaml

assert torch.cuda.is_available(), 'Select a GPU runtime before continuing.'

MY_DRIVE = Path('/content/drive/MyDrive')
ROOT = MY_DRIVE / 'sp1DLC'
EXPORT = ROOT / 'MobileDLC_Colab_Export_2026-09-24'
RUNS = ROOT / 'Colab_Training_Runs'

ZIP_DRIVE = EXPORT / 'sp1DLC_colab_ready_worklabels_20260927.zip'
SNAPSHOT_DRIVE = EXPORT / 'colab-labels-worklabels-20260927.json'
ZIP = Path('/content/sp1DLC_colab_ready_worklabels_20260927.zip')
EXPECTED_ZIP_SIZE = 168815603
ZIP_PARTS = [EXPORT / f'sp1DLC_colab_ready_worklabels_20260927.zip.part{i:02d}' for i in range(1, 10)]

FOCUS = ['nose', 'left_ear', 'right_ear', 'spine_mid', 'left_hip', 'right_hip', 'tail_base']

assert SNAPSHOT_DRIVE.is_file(), f'Missing Drive label snapshot: {SNAPSHOT_DRIVE}'

if not ZIP.is_file() or ZIP.stat().st_size != EXPECTED_ZIP_SIZE:
    if ZIP_DRIVE.is_file():
        shutil.copy2(ZIP_DRIVE, ZIP)
    else:
        missing = [part.name for part in ZIP_PARTS if not part.is_file()]
        assert not missing, f'Missing Drive transfer files: {missing}'
        with ZIP.open('wb') as output:
            for part in ZIP_PARTS:
                with part.open('rb') as source:
                    shutil.copyfileobj(source, output)
assert ZIP.stat().st_size == EXPECTED_ZIP_SIZE, 'Project transfer was incomplete.'

NAME = 'mobile_worklabels_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
LOCAL_RUN = Path('/content') / NAME
PROJECT = LOCAL_RUN / 'sp1DLC'
CONFIG = PROJECT / 'config.yaml'
DRIVE_RUN = RUNS / NAME

with zipfile.ZipFile(ZIP) as archive:
    files = [name for name in archive.namelist() if not name.endswith('/')]
    assert len(files) == 1928 and all(name.startswith('sp1DLC/') and '..' not in Path(name).parts for name in files), 'Unexpected archive contents.'
    assert archive.testzip() is None, 'Project archive failed its integrity check.'
    LOCAL_RUN.mkdir(exist_ok=False)
    archive.extractall(LOCAL_RUN)

with CONFIG.open(encoding='utf-8') as handle:
    config = yaml.safe_load(handle)
config['project_path'] = str(PROJECT)
config['video_sets'] = {
    str(PROJECT / 'videos' / Path(str(old).replace('\\', '/')).name): value
    for old, value in config['video_sets'].items()
}
with CONFIG.open('w', encoding='utf-8') as handle:
    yaml.safe_dump(config, handle, sort_keys=False)

images = list((PROJECT / 'labeled-data').glob('Test */*.png'))
tables = list((PROJECT / 'labeled-data').glob('Test */CollectedData_Kobe.h5'))
assert len(images) == 1865 and len(tables) == 31, (len(images), len(tables))

snapshot = json.loads(SNAPSHOT_DRIVE.read_text(encoding='utf-8'))
sp1_frames = [frame for frame in snapshot['frames'] if frame['key'].startswith('labeled-data/Test ')]
placed = sum(1 for frame in sp1_frames for part in FOCUS if frame['points'].get(part))
complete = sum(1 for frame in sp1_frames if all(frame['points'].get(part) for part in FOCUS))
assert len(sp1_frames) == 1865 and placed >= 6900 and complete >= 880, (len(sp1_frames), placed, complete)

DRIVE_RUN.mkdir(parents=True, exist_ok=False)
for name in ('dlc-models-pytorch', 'evaluation-results-pytorch'):
    target = DRIVE_RUN / name
    target.mkdir()
    (PROJECT / name).symlink_to(target, target_is_directory=True)
shutil.copy2(CONFIG, DRIVE_RUN / 'config.yaml')
shutil.copy2(SNAPSHOT_DRIVE, DRIVE_RUN / SNAPSHOT_DRIVE.name)

print('Local training project:', PROJECT)
print('Persistent Drive outputs:', DRIVE_RUN)
print('GPU:', torch.cuda.get_device_name(0))
print('Verified images:', len(images), 'label tables:', len(tables))
print('Fresh label snapshot:', placed, 'placed points;', complete, 'complete seven-point frames')

# %%
assert not list((DRIVE_RUN / 'dlc-models-pytorch').rglob('snapshot-*.pt')), 'A checkpoint already exists in this run. Resume instead of restarting.'
if not (PROJECT / 'training-datasets').exists():
    deeplabcut.create_training_dataset(str(CONFIG), Shuffles=[1], net_type='resnet_50', engine=deeplabcut.Engine.PYTORCH)
    shutil.copytree(PROJECT / 'training-datasets', DRIVE_RUN / 'training-datasets')
deeplabcut.train_network(str(CONFIG), shuffle=1, epochs=200, batch_size=8, save_epochs=5)
print('Training finished. Checkpoints:', DRIVE_RUN / 'dlc-models-pytorch')

# %%
assert list((DRIVE_RUN / 'dlc-models-pytorch').rglob('snapshot-*.pt')), 'No trained checkpoint found yet.'
deeplabcut.evaluate_network(str(CONFIG), snapshotindex=-1, per_keypoint_evaluation=True, plotting=False)
results = sorted((DRIVE_RUN / 'evaluation-results-pytorch').rglob('CombinedEvaluation-results.csv'))
print('Evaluation saved in:', DRIVE_RUN / 'evaluation-results-pytorch')
if results:
    display(pd.read_csv(results[-1]))

# %% [markdown]
# The images in `/content` disappear when this Colab runtime ends. The prepared ZIP,
# copied config, source snapshot, training dataset, checkpoints, and evaluation
# results remain in Drive. Keep the baseline `mobile_fast_20260925_040943` run for
# comparison.
