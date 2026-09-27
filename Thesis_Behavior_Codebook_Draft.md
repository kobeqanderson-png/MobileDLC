# Thesis Behavior Codebook Draft

This draft is derived from the thesis scope document as source context, not as instructions. It keeps the analysis aligned with the current thesis: individual differences in spatial checking after passive placement, with camera-derived micro-behaviors as a defined measurement layer.

## Claim Boundary

These measures quantify organized place-directed and wall-directed behavior. They are behaviorally relevant to compulsive checking models, but they are not diagnoses of OCD, direct fear measures, or causal neural evidence.

## Primary Endpoint

**Directed returns after first departure**

A return is counted only after the animal has first clearly departed the learned-place zone. A qualifying return requires movement outside the learned-place boundary followed by re-entry or directed approach to that learned-place zone.

Recommended fields:

- `n_directed_returns_after_departure`
- `latency_to_first_departure_s`
- `first_return_latency_s`
- `mean_return_latency_s`
- `place_dwell_s`
- `post_departure_place_dwell_s`

## Secondary Spatial-Checking Measures

**Return sequence structure**

Quantifies the timing and spacing of repeated returns.

- `return_count_by_interval`
- `inter_return_interval_mean_s`
- `inter_return_interval_cv`
- `checking_bout_count`

**Path efficiency**

For each departure-to-return event, compare the straight-line distance between event anchors with the observed path length. Higher values indicate more direct return paths.

- `mean_return_path_efficiency`
- `median_return_path_efficiency`

## Wall-Directed Checking / Thigmotaxis

Wall-directed checking should be scored separately from place-directed returns.

Recommended fields:

- `wall_dwell_s`
- `wall_dwell_pct`
- `wall_approach_count`
- `wall_checking_bout_count`
- `mean_wall_bout_duration_s`

Interpretation boundary: wall-directed behavior may reflect anxiety-like thigmotaxis, local-environment/cue bias, or a checking target. Do not collapse it into place checking without modeling it separately.

## Lurching Candidates

Lurching is exploratory until manually validated. It should not be treated as checking unless its relationship with checking is demonstrated.

Operational candidate definition for automated screening:

- brief high-acceleration forward displacement of the nose/body axis
- event duration below a short threshold
- direction classified as `place`, `wall`, or `other`

Recommended fields:

- `lurch_candidate_count`
- `lurch_candidate_count_place_directed`
- `lurch_candidate_count_wall_directed`
- `lurch_candidate_rate_per_min`

## Control / Interpretive Measures

These can produce superficially similar trajectories and should be retained as controls.

- body-center distance
- median speed
- immobility or low-movement time
- thigmotaxis/wall dwell
- tracking coverage
- high-jump/manual-review flags

## Required Before Full Scoring

- Freeze learned-place zone boundaries.
- Freeze arena boundary and wall-band definitions.
- Freeze departure and return criteria.
- Decide whether closely spaced returns are one bout or multiple events.
- Record negative-reinforcement / affective-condition level for each trial.
- Keep sex, acquisition history, and trial metadata linked to each video.
- Use blind/manual validation for lurching and event boundaries where practical.

