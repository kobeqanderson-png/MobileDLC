# Independent Mobile DLC Labeler

Live: https://mobile-dlc-labeler.mobile-dlc-independent-labeler.workers.dev/

For labeling, sharing, presentations, backups, and troubleshooting, see the [user manual](../Mobile_DLC_Labeler_User_Manual.md).
For hosting and monitoring, see [Keeping the Site Live](../Site_Operations_Guide.md).

The shareable QR is `../Share_Independent_Labeler_QR.png` and also appears in the editor's **Share labeler** section. The access code is stored locally in the ignored `imports/access-code.txt`; share it separately from the QR. Visitors enter it once per device and do not need a Cloudflare or ChatGPT account.

This site runs on the Cloudflare Workers Free plan with D1 for edits and protected Worker Static Assets for 2,505 frame images: 1,865 sp1DLC frames plus 640 EPM frames. It does not use R2 or a paid plan. The original labels remain keyed to their unchanged frame paths; the EPM frames start unlabeled. Workers Free request and CPU limits still apply.

## Maintenance

The deployed D1 ID is pinned in `wrangler.jsonc` so future deploys use the same labels. To redeploy from this directory after making code changes, sign in to the same Cloudflare account and run `npm run deploy`. The frozen images live in `imports/frame_snapshot` and are copied into the build. `npm test` runs the app and migration tests. For the gesture and layout smoke test, run `npm run build` and then `npx wrangler dev --persist-to imports/playwright-state` in one terminal, with `npm run test:browser` in another. This keeps test edits out of the default local D1 store.

The launch-time old-site export, Cloudflare export, and one-time migration SQL are in the ignored `imports/` directory. Keep these files backed up. Do **not** rerun `imports/migration.sql` on the live database; it was for the initial empty D1 only. A fresh export can be downloaded from the editor whenever needed.

The EPM frames were sampled from `Downloads/EPM/Test N.mp4` at 20 frames per video with `import_paradigm.mjs`. To import another experiment later, first provide readable MP4 exports and back up live labels. The OFPO files currently available are `.szv` recordings, which `ffmpeg` cannot decode; OFPO is not on the site yet.

## Back to DLC

The original DLC project and laptop labeler were not changed. To bring a downloaded label snapshot back to DLC on this laptop, run `& "C:\Users\kobeq\miniconda3\envs\dlc\python.exe" import_hosted.py <snapshot.json> <DLC-project-folder>` in PowerShell. The conversion writes new H5/CSV files under `imports/` without replacing source files. A mixed sp1DLC/EPM snapshot exports only the original sp1DLC folders to this DLC project.
