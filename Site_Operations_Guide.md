# Mobile DLC Labeler: Keeping the Site Live

Last checked: September 25, 2026

## The short answer

**Yes, you can turn your laptop off.** The live labeler, its 2,505 frame images across sp1DLC and EPM, and its shared label database are hosted in your Cloudflare account. They are not served from `Start_Labeler.bat`. You do **not** need to run Python, npm, Wrangler, a terminal window, or a laptop server for collaborators to use the live site.

Live site: https://mobile-dlc-labeler.mobile-dlc-independent-labeler.workers.dev/

The laptop is needed only to edit/deploy the app, convert a downloaded snapshot back to DLC, or use the separate local labeler. Turning it off does not sign people out of the cloud site or stop Cloudflare from saving edits. This follows from the current app configuration: the Worker serves the site and images, while Cloudflare D1 stores edits. The site still depends on your Cloudflare account, deployed Worker, D1 database, internet access, and free-plan limits. It is not an uptime guarantee.

## What to do routinely

| When | Check |
| --- | --- |
| Before sharing or presenting | Open the live URL on a phone using cellular data. Confirm the access-code page appears, sign in, and check an image in both worklists: `1,865` sp1DLC frames and `640` EPM frames. |
| After a labeling session | Wait for **Saved**, then use **Download label snapshot**. Keep dated copies in more than one place. |
| Once a week while the project is active | Sign in, open frames from both experiments, confirm images and labels load, and download a fresh snapshot. Do not make a test marker on real data. |
| Once a month, and after any outage | Check Cloudflare Worker error/usage graphs and D1 row usage. Confirm the account email still receives Cloudflare notices. |
| After a deployment or secret change | Recheck login, real frame loading, saved labels, and snapshot download from the live URL. |

The **access-code page alone is not a full health check**. It can load even if the label database is unavailable. A meaningful check reaches a real frame and loads its labels and image. A snapshot download additionally verifies the export path. Do not put the access code into a public uptime-checking service.

## Cloudflare dashboard checks

1. Sign in to the Cloudflare account that owns the site. Open **Workers & Pages**, then the Worker named `mobile-dlc-labeler`.
2. In its **Metrics**, look at requests, errors, and invocation status. A sustained rise in errors matters more than a single transient failure. Cloudflare's [Workers metrics guide](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) explains the graphs.
3. Open the D1 database named `mobile-dlc-labeler-db`. Review **Metrics > Row Metrics** for rows read and written, and watch for usage approaching the free limits ([D1 pricing and metrics](https://developers.cloudflare.com/d1/platform/pricing/)).
4. For a failure you can reproduce, check the Worker's dashboard logs if available or run `npx wrangler tail mobile-dlc-labeler` from the `independent_labeler` directory while reproducing it ([Wrangler tail](https://developers.cloudflare.com/workers/wrangler/commands/workers/)). The tail command is for diagnosis; it does not need to run continuously to keep the site alive.
5. Check [Cloudflare Status](https://www.cloudflarestatus.com/) when Cloudflare services seem broadly affected. You can subscribe to status-page incident notifications, but those alerts report Cloudflare incidents, **not** every problem in your own labeler ([Cloudflare status guide](https://developers.cloudflare.com/support/cloudflare-status/)).

**No automatic app-specific uptime alert is configured in this project.** A third-party HTTPS monitor could alert when the public login page stops responding, but it would not prove that sign-in, D1, images, or saving work. Keep the signed-in functional check above even if you later add a monitor.

## Free-plan limits and continuity

The current deployment uses Workers Free and D1 Free. Cloudflare currently lists **100,000 Worker requests/day**, resetting at midnight UTC ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), and **5 million D1 rows read/day**, **100,000 rows written/day**, and **5 GB total D1 storage** ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). These limits are account-wide, not necessarily exclusive to this site, and Cloudflare can change them. A normal page visit makes several requests; do not treat 100,000 as 100,000 complete editing sessions.

On the free plan, exceeding a daily Worker request limit can produce Cloudflare error `1027`; hitting D1 daily row limits can make database queries fail until the limit resets at midnight UTC. Stored labels are not erased by a daily D1 limit ([D1 limit enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)). Do not upgrade to a paid plan just because an error appears; first identify the actual cause and current usage. D1's free point-in-time recovery window is limited, so your downloaded JSON snapshots remain important ([D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)).

The `workers.dev` URL is supplied by Cloudflare. It does not need a domain renewal payment from you, but it depends on the Cloudflare account and route remaining active. Avoid deleting the Worker, D1 database, static assets, or account. Keep access to the account and its recovery email. If this becomes a critical long-term service, consider a custom domain and stronger monitoring later; the current free `workers.dev` setup is intended for personal or hobby use ([Cloudflare workers.dev guidance](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)).

## If the site seems down

1. Confirm you are using the Cloudflare URL above, not an old ChatGPT link or a `localhost`/laptop QR. Try cellular data and another browser/device.
2. If the login page loads but the editor does not, check whether the code is correct and whether you are rate-limited. A code error is different from an outage.
3. If you can sign in but frames, images, or downloads fail, stop editing and note the exact error, experiment, video folder, frame, and time. Check Worker Metrics and D1 Row Metrics. If a save failed, **do not assume the label was stored**.
4. Check Cloudflare Status. For a persistent app error, reproduce it while viewing Worker logs or `wrangler tail`.
5. If a free-plan daily limit is reached, reduce traffic and wait for the midnight-UTC reset, or decide deliberately whether a paid plan is justified. If the problem followed a deployment, preserve a snapshot and investigate that deployment; do not rerun the one-time migration SQL or delete D1.
6. Once the site is back, sign in and verify a real frame, then download a new label snapshot and compare with your last backup if data integrity is in question.

For the labeling controls, export-to-DLC steps, and symptom-by-symptom help, see the [user manual](Mobile_DLC_Labeler_User_Manual.md).
