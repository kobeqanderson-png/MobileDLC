# Thesis Data Analysis Roadmap

This roadmap separates analyses into two lanes:

1. **Core thesis analyses**: easy to replicate, easy to defend, and directly tied to the thesis aims.
2. **Advanced discovery analyses**: novel, exploratory, and useful for finding behavioral structure you may not already expect.

The two lanes should be reported differently. Core analyses can support thesis claims. Advanced analyses can generate figures, hypotheses, and future-study directions, but should be framed as exploratory unless validated.

## Core Analyses: Defensible and Replicable

### 1. Tracking Quality Control

Purpose: prove the pose-estimation data are good enough for behavior analysis.

Primary outputs:

- bodypart visibility percentage
- median likelihood by bodypart
- body-center usable-frame percentage
- high-jump/manual-review flags
- representative trajectory pages

Defensible language:

> Tracking quality was quantified before behavioral scoring. Videos with low body-center coverage or large frame-to-frame jumps were flagged for visual review.

### 2. Locomotor and State Controls

Purpose: show checking is not trivially explained by activity, immobility, or swim/movement speed.

Primary outputs:

- total body-center distance
- median speed or pixels/frame
- low-movement time
- movement bout count
- active-frame percentage

Defensible language:

> Locomotor activity and low-movement time were retained as control variables because they can produce trajectories that superficially resemble checking.

### 3. Place-Directed Checking

Purpose: primary thesis phenotype.

Requires: frozen learned-place zone and departure/return criteria.

Primary outputs:

- directed returns after first departure
- latency to first departure
- first return latency
- mean return latency
- cumulative learned-place dwell
- post-departure place dwell
- return bout count
- return path efficiency

Defensible language:

> The primary endpoint was the number of directed returns to the learned-place zone after first departure. This captures organized repetition more directly than dwell time alone.

### 4. Wall-Directed Checking / Thigmotaxis

Purpose: separate place-directed checking from wall-directed checking.

Requires: frozen arena boundary and wall-band width.

Primary outputs:

- wall dwell time
- wall dwell percentage
- wall-band bout count
- mean wall-bout duration
- wall-directed lurch/approach candidates

Defensible language:

> Wall-directed behavior was analyzed separately from learned-place checking to avoid collapsing thigmotaxis, cue/local-environment bias, and checking into a single measure.

### 5. Individual Differences

Purpose: match the thesis frame: variance is the object of analysis.

Primary outputs:

- distributions of checking measures
- correlations among checking, locomotor controls, wall-directed measures
- sex-aware summaries when metadata are linked
- continuous models before high/low group splits

Defensible language:

> Individual variation was modeled continuously before considering exploratory grouping.

## Core Statistical Plan

Start simple and defensible:

- descriptive plots for each endpoint
- correlation matrix across key measures
- linear models for primary checking outcome
- include locomotor controls before interpretation
- sex and affective condition as predictors/moderators when metadata are available

Example model family:

```text
directed_returns_after_departure
  ~ sex
  + affective_condition/platform_depth
  + acquisition_history
  + total_distance_px
  + wall_dwell_pct
```

Interpretation boundary:

- Do not claim checking is independent of locomotion until controls are included.
- Do not reduce sex effects to anxiety.
- Do not treat wall behavior and place-directed checking as the same phenotype.
- Do not make causal PV/PNN claims from correlational histology.

## Advanced Discovery Analyses: Novel but Exploratory

These analyses are useful because they may reveal behavioral organization you are not explicitly looking for.

### 1. Unsupervised Behavioral Motifs

Goal: discover repeated movement motifs from pose features without hand-labeling every behavior.

Feature examples:

- body-center speed
- acceleration
- angular velocity / heading change
- body elongation
- nose-to-tail orientation
- distance to learned place
- distance to wall
- nose advance while hips remain stable

Methods:

- PCA or UMAP for visualization
- HDBSCAN or Gaussian mixture models for clusters
- motif transition matrices

Defensible framing:

> We used unsupervised analysis to identify candidate movement motifs for later manual validation.

Do not frame clusters as final behaviors until manually reviewed.

### 2. Behavioral State Sequences

Goal: show how animals transition among states over time.

Candidate states:

- near learned place
- away from learned place
- wall band
- active transit
- low movement
- lurch candidate

Outputs:

- transition matrices
- state occupancy over time
- entropy of state transitions
- return-to-place sequence diagrams

Why it is useful:

This directly addresses organization, persistence, and behavioral updating.

### 3. Checking Microstructure

Goal: move beyond total return count.

Outputs:

- inter-return intervals
- repeated-return bouts
- return path efficiency
- checking over early/middle/late test intervals
- escalation or extinction-like decline over time

Novel angle:

Two animals can have the same return count but different temporal organization.

### 4. Lurching Candidate Detection

Goal: identify rapid, directed micro-movements that may be missed by overt return counts.

Automated candidate features:

- high acceleration
- brief duration
- nose/body displacement
- direction toward place, wall, or other
- hips relatively stable vs whole-body displacement

Validation plan:

- auto-detect candidates
- sample clips
- manually label true/false lurching
- tune threshold or train SiMBA classifier

### 5. SiMBA Supervised Classifiers

Use SiMBA after the codebook is stable.

Start with three classes:

- locomotion / transit
- immobility or low-movement
- lurching / stretch-like movement candidate

Add later if visually separable:

- place-directed checking
- wall-directed checking
- rearing-like posture, if top-down pose supports it

Best use of SiMBA:

Manual labels should teach the classifier events that are not captured by simple zone logic. Zone occupancy and return counts do not need SiMBA.

## Recommended Order

1. Run tracking QC.
2. Freeze arena and learned-place zone definitions.
3. Run core place-directed and wall-directed checking analysis.
4. Add metadata: sex, condition/depth, acquisition history, subject IDs.
5. Run core statistics and plots.
6. Use advanced analyses to identify candidate motifs and lurching events.
7. Use SiMBA only after the behavior codebook has stable labels.

## Committee-Safe Summary

Use this hierarchy:

- Primary: directed returns after first departure.
- Secondary: departure latency, return latency, place dwell, path efficiency.
- Controls: locomotion, immobility/low movement, tracking QC.
- Separate phenotype: wall-directed checking/thigmotaxis.
- Exploratory: lurching candidates and unsupervised behavioral motifs.

