# Frontend Metrics Audit

## Scope

This document traces the rendered frontend metrics to the backend code that computes them. It covers charts, KPI cards, and important metric cards/grids that encode calculated values. It is written as an implementation audit, not as a pitch deck for fabricated features.

Important notes:

- The active page [`frontend/src/app/custom-kpis/page.tsx`](../frontend/src/app/custom-kpis/page.tsx) does **not** render charts or dashboard KPI cards. It renders forms, saved KPI records, SQL/code blocks, scalar values, and tables.
- The metric-heavy pages are:
  - `executive-summary`
  - `usage`
  - `content`
  - `entities`
  - `quality`
  - `explorer`
  - `control-tower`
  - `nlp-pipeline` (dynamic chart from arbitrary query results)
- The best credible story for judges is not "we did magic". It is:
  - we chose the correct measurement grain for each business question,
  - we avoid double counting by using distinct input/output subqueries where needed,
  - we convert raw warehouse facts into operationally interpretable visuals and KPI summaries.

## Core Architectural Idea

The backend consistently separates three grains:

- **Input grain**: uploaded source videos from `FactInputVideoOperations`
- **Output grain**: processed/generated clips from `FactOutputVideoOperations`
- **Publish grain**: publish events from `FactPublishInformation`

That distinction matters because the same business question can be wrong if measured on the wrong grain.

Examples:

- "How many source videos were uploaded?" should be input grain.
- "How many clips were created?" should be output grain.
- "How many outputs actually reached an audience?" should be publish grain, usually collapsed to first-publish per output when measuring unique published outputs.

This is the single strongest technical justification in the product.

## Shared Backend Building Blocks

These helpers drive most chart calculations:

- [`app/services/analytics_service.py`](../app/services/analytics_service.py)
  - `apply_date_filter(...)`
  - `apply_dimension_filters(...)`
  - `build_processed_input_subquery(...)`
  - `build_published_input_subquery(...)`
  - `build_published_output_subquery(...)`
  - `compute_kpi_summary(...)`
- Key effect:
  - published-input metrics count **distinct uploaded inputs that eventually got published**
  - published-output metrics count **distinct outputs that reached publish**
  - processed-input metrics count **distinct uploaded inputs that generated at least one output**

That design prevents a common demo mistake: comparing unlike units inside the same chart.

## KPI Card Philosophy

The KPI cards across the frontend mostly fall into four buckets:

- **Direct count cards**: raw counts or durations pulled from a specific pipeline stage
- **Conversion cards**: ratios between two pipeline stages
- **Composite cards**: weighted scores built from multiple operational components
- **Portfolio cards**: concentration, reuse, saturation, and reach metrics

The strongest justification is that the cards are not random headline numbers. Most are either:

- directly tied to a warehouse fact grain, or
- deliberately derived from clearly named operational primitives.

---

## 1. Usage & Trends Page

Frontend: [`frontend/src/app/usage/page.tsx`](../frontend/src/app/usage/page.tsx)  
Backend: [`app/routers/trends.py`](../app/routers/trends.py), [`app/routers/multi_dimension.py`](../app/routers/multi_dimension.py)

### KPI Cards

- This page has no `KpiCard` components.
- That is defensible:
  - this page is trend-first, not summary-first
  - the charts themselves carry the signal better than collapsing them into static top-line cards

### Pipeline Volume Over Time

- Frontend chart: `AreaChart`
- Backend endpoints:
  - `/trends/timeseries`
  - `/trends/processed-timeseries`
  - `/trends/published-timeseries`
- Calculation:
  - `timeseries`: count of uploaded inputs by period, sum of uploaded duration
  - `processed-timeseries`: count of output clips by period, sum of created duration
  - `published-timeseries`: count of **distinct outputs**, grouped by first publish period
- Frontend shaping:
  - merges three series by period into `{ Uploaded, Processed, Published }`
- Why this is good:
  - it shows the actual pipeline widening/narrowing across stages instead of pretending all stages are the same object
  - published outputs are deduplicated by output, not inflated by multiple publish events
- Honest upgrade ideas:
  - confidence bands on expected throughput using seasonal decomposition
  - anomaly overlays using STL + residual z-score instead of plain trend viewing
  - queue backlog line: `processed - published`

### Cumulative Growth

- Frontend chart: `LineChart`
- Backend endpoint: `/trends/cumulative`
- Calculation:
  - daily uploaded count is accumulated in application code into running totals
- Why this is good:
  - cumulative curves make acceleration/slowdown visually obvious even when daily noise is high
- Honest upgrade ideas:
  - switch to normalized cohort-adjusted cumulative growth
  - add rolling 7-day and 28-day cumulative slope as momentum measures

### Growth Rate

- Frontend chart: `BarChart`
- Backend endpoint: `/trends/growth-rate`
- Calculation:
  - period-over-period growth % of uploaded input count
  - formula: `(current_count - previous_count) / previous_count * 100`
- Why this is good:
  - simple, interpretable, and directly tied to demand/usage growth
- Honest upgrade ideas:
  - use log growth for stability when volume is volatile
  - add Bayesian shrinkage for low-volume periods

### Multi-Dimensional Heatmap

- Present in code but currently commented out in the UI
- Backend endpoint: `/dimensions/heatmap`
- Calculation:
  - count of uploaded inputs grouped by `dimension1 x dimension2`
- Why this is good:
  - high signal for concentration and imbalance
- Honest upgrade ideas:
  - mutual information score for dimension-pair strength
  - chi-square standardized residual heatmap instead of raw count heatmap

---

## 2. Content & Publishing Funnel Page

Frontend: [`frontend/src/app/content/page.tsx`](../frontend/src/app/content/page.tsx)  
Backend: [`app/routers/funnel.py`](../app/routers/content_mix.py), [`app/routers/language_analytics.py`](../app/routers/platform_analytics.py)

### KPI Cards: Funnel Conversion Summary

- Frontend cards:
  - `Upload -> Process`
  - `Process -> Publish`
  - `End-to-End Rate`
- Backend source:
  - all three are derived in frontend from `/funnel/overview`
- Calculation:
  - `Upload -> Process = processed_inputs / uploaded_inputs * 100`
  - `Process -> Publish = published_inputs / processed_inputs * 100`
  - `End-to-End Rate = published_inputs / uploaded_inputs * 100`
- Why this is good:
  - the cards summarize the funnel in the cleanest possible way without introducing a new opaque metric
  - all three use the same unit: distinct source-video inputs
- Honest upgrade ideas:
  - confidence intervals around conversion
  - segmented funnel cards by channel family or client tier

### Publishing Funnel

- Frontend visual: custom funnel cards
- Backend endpoint: `/funnel/overview`
- Calculation:
  - Uploaded = count of input videos
  - Processed = count of distinct uploaded inputs with at least one output
  - Published = count of distinct uploaded inputs with at least one published output
  - Drop-off %:
    - Uploaded -> Processed: `1 - processed/uploaded`
    - Processed -> Published: `1 - published/processed`
- Why this is good:
  - it measures source-video conversion at each stage, which is the cleanest workflow view
- Honest upgrade ideas:
  - stage survival model with hazard rate per step
  - median and p90 dwell times embedded into the funnel

### Funnel by Channel

- Frontend chart: grouped `BarChart`
- Backend endpoint: `/funnel/by-dimension` with `dimension=channel`
- Calculation:
  - per channel: uploaded_count, processed_count, published_count
  - conversion percentages also returned
- Why this is good:
  - preserves comparable units across channels and exposes where throughput gets stranded
- Honest upgrade ideas:
  - expected-vs-actual conversion using hierarchical baselines by client

### Publishing Bottlenecks

- Frontend: table
- Backend endpoint: `/funnel/bottlenecks`
- Calculation:
  - `gap_count = processed_count - published_count`
  - `gap_pct = gap_count / processed_count * 100`
- Why this is good:
  - directly ranks wasted pipeline effort
- Honest upgrade ideas:
  - lost-hours weighting instead of only lost-count weighting

### Output Format Distribution

- Frontend chart: `PieChart`
- Backend endpoint: `/content/output-type-mix`
- Calculation:
  - combines two sources with `union_all(...)`
    - input-side declared output type from `FI`
    - actual created output type from `FO`
  - grouped by output type
  - `share_pct = count / total_count * 100`
- Why this is good:
  - it captures both planned output intent and realized output production
  - this is more nuanced than only counting outputs
- Honest upgrade ideas:
  - split planned-vs-realized mix into dual-layer donut
  - Jensen-Shannon divergence between intended and realized format mix

### Input Source Distribution

- Frontend chart: `PieChart`
- Backend endpoint: `/content/input-type-mix`
- Calculation:
  - uploaded input count and duration by input type
- Why this is good:
  - distinguishes supply mix from downstream editorial choices
- Honest upgrade ideas:
  - source-mix entropy score

### Output Type Trends Over Time

- Frontend chart: stacked `AreaChart`
- Backend endpoint: `/content/type-trends`
- Calculation:
  - same dual-source output-type logic as above, grouped by period
  - frontend pivots type labels into stacked series
- Why this is good:
  - shows whether the content portfolio is diversifying or collapsing into a few types
- Honest upgrade ideas:
  - Herfindahl-Hirschman Index over time
  - change-point detection for editorial strategy shifts

### Language Distribution

- Frontend chart: `BarChart`
- Backend endpoint: `/languages/distribution`
- Calculation:
  - uploaded input count and duration by language
  - share of total also computed
- Why this is good:
  - language is an upstream capacity signal, not just a publishing outcome
- Honest upgrade ideas:
  - separate source-language vs output-language mix to quantify localization lift

### Platform Distribution

- Frontend chart: `PieChart`
- Backend endpoint: `/platforms/distribution`
- Calculation:
  - publish-event count and duration by platform
- Why this is good:
  - publishing surfaces are naturally publish-grain, so this metric uses the right fact table
- Honest upgrade ideas:
  - unique-output platform distribution instead of publish-event distribution when duplicate multi-posting is a concern

---

## 3. Executive Summary Page

Frontend: [`frontend/src/app/executive-summary/page.tsx`](../frontend/src/app/executive-summary/page.tsx)  
Backend: multiple, mainly `kpi`, `trends`, `funnel`, `rankings`, `operational`, `productivity`, `alerts`

### KPI Cards: Pipeline Performance

- Frontend cards:
  - `Videos Uploaded`
  - `Videos Processed`
  - `Videos Published`
- Backend source:
  - derived from `/funnel/overview`
  - deltas are calculated in frontend by comparing current funnel counts to a previous date window
- Calculation:
  - Uploaded = count of input videos
  - Processed = count of distinct uploaded inputs with at least one output
  - Published = count of distinct uploaded inputs with at least one published output
  - each card description also surfaces stage-specific hours
- Why this is good:
  - this is the correct executive rollup of the source-video funnel
  - the delta logic is transparent rather than hidden in the backend

### KPI Cards: Operational Metrics

- Frontend source:
  - `op` object from `/kpi/operational`
- Backend: [`app/routers/operational_kpis.py`](../app/routers/operational_kpis.py)

#### Core Activity

- `Active Clients` = distinct clients with uploads in range
- `Active Users` = distinct users with uploads in range
- `Active Channels` = distinct channels with uploads in range
- `Clip Multiplication` = `total_outputs / unique_inputs`
- `Conversion Rate` = `inputs_with_output / total_inputs * 100`
- Why this is good:
  - these cards distinguish platform adoption from pipeline productivity

#### Velocity & Reach

- `Billable Rate` = billable publish events / total publish events
- `Duration Compression` = avg output duration / avg input duration
  - frontend displays it as a percent
- `Avg Upload -> Process` = mean days from upload date to first create date
- `Avg Process -> Publish` = mean days from create date to first publish date
- `Platforms Reached` = distinct platforms used in publish events
  - description also shows distinct languages used
- Why this is good:
  - combines cost/revenue surface, transformation efficiency, latency, and distribution breadth

#### Quality & Localization

- `Data Completeness` = `(total pipeline records - dq_errors) / total pipeline records * 100`
- `Publishing Dropout` = outputs without any publish event / total outputs * 100
- `Translation Rate` = outputs where output language != source language / total outputs * 100
- `Translation Uplift` = avg translated published duration / avg non-translated published duration
- `Weekend Publish Rate` = weekend publish events / total publish events * 100
- Why this is good:
  - turns metadata quality and localization behavior into operational KPIs instead of hiding them in detail pages

#### Repurposing & Diversity

- `Content Reuse Ratio` = average distinct output types generated per input
- `Full Repurposing` = share of inputs generating all 5 output types
- `Mix Fragment Rate` = share of `mix`-language outputs that are not `Full Package`
- `Languages / Channel` = average distinct languages served by each active channel
- Why this is good:
  - these cards quantify whether the system is really repurposing content or just producing more of the same

#### Saturation & Throughput

- `Client Platform Saturation` = avg distinct platforms per client, shown against total available platforms
- `Channel Throughput Gap` = avg monthly published clips per channel, with best/worst/stddev in description
- `Client Throughput Cliff` = avg monthly published clips per client, with best and worst client context
- Why this is good:
  - these cards surface distribution inequality without forcing users into charts first

#### User Retention & Cohorts

- `Upload Retention` = share of uploading users active in 7+ months
- card description also includes single-month uploader %
- `Rarely Active CMR` = `rarely_active_clips_per_upload / active_user_clips_per_upload`
- Why this is good:
  - unusually strong card set because it already goes beyond raw volume into behavioral cohort structure

### KPI-Style Output Format Breakdown Cards

- Frontend renders one small card per output type using `/kpi/cards`
- Calculation per card:
  - `total_count`
  - `total_duration_hours`
  - `publish_rate_pct`
- Why this is good:
  - these are effectively KPI cards for every format category
  - the page avoids another noisy chart by using a scannable card grid
- Honest upgrade ideas:
  - add billable yield and gap-to-publish on each format card

### Pipeline Trend

- Same logic as Usage page, but always daily
- Good justification:
  - gives leadership a compact end-to-end operational pulse

### Top Channels

- Frontend chart: horizontal `BarChart`
- Backend endpoint: `/rankings/top-n` with `dimension=channel`
- Calculation:
  - top channels by uploaded input count
- Why this is good:
  - summary page should rank demand/usage leaders first, not bury them in tables
- Honest upgrade ideas:
  - contribution-to-growth instead of raw count ranking

### Output Mix

- Frontend chart: `PieChart`
- Backend endpoint: `/kpi/cards`
- Calculation:
  - per output type:
    - `total_count` from input-side declared output type + output-side created type
    - `published_count` from distinct published outputs
    - `publish_rate_pct = published_count / total_count * 100`
- Why this is good:
  - lets leadership compare production volume and eventual publish success by format
- Honest upgrade ideas:
  - efficiency frontier: publish rate vs volume vs billable yield

### Category Clip Rate & Publish Rate

- Frontend chart: `ComposedChart`
- Backend endpoint: `/kpi/content-category-performance`
- Calculation:
  - per output category:
    - `total_uploads`
    - `total_outputs`
    - `total_published`
    - `clip_multiplication_rate = outputs / unique_inputs`
    - `publish_rate_pct = published / outputs * 100`
    - `billable_rate_pct = billable / published * 100`
- Why this is good:
  - the bar-line combo compares scale and efficiency without mixing them into one fake score
- Honest upgrade ideas:
  - Pareto frontier highlighting dominant categories

### Pipeline Velocity

- Frontend chart: `ComposedChart`
- Backend endpoint: `/productivity/pipeline-velocity`
- Calculation:
  - upload-to-process days: first create date minus upload date at input grain
  - process-to-publish days: first publish date minus create date at output grain
  - end-to-end = sum of both
  - throughput = output_count
- Why this is good:
  - latency and throughput are shown together, which is operationally correct
- Honest upgrade ideas:
  - percentile latency bands instead of only averages
  - Little’s Law style queue estimates

### Team Efficiency Radar

- Frontend chart: `RadarChart`
- Backend endpoint: `/productivity/team-efficiency`
- Calculation:
  - `uploads_per_member`
  - `clips_per_upload`
  - `publish_rate_pct`
  - `efficiency_score = uploads_per_member*0.4 + clips_per_upload*15 + publish_rate_pct*0.45`
- Frontend rescales some metrics for plotting
- Why this is good:
  - compares capacity, productivity, and conversion together
- Honest upgrade ideas:
  - z-score normalization before composite scoring
  - principal-component-based efficiency index

### Category Volume Distribution

- Frontend chart: grouped `BarChart`
- Backend endpoint: `/kpi/content-category-performance`
- Calculation:
  - plots `total_uploads`, `total_outputs`, `total_published` side by side
- Why this is good:
  - makes category shrinkage through the funnel instantly visible
- Honest upgrade ideas:
  - waterfall per category instead of clustered bars

---

## 4. Entities Page

Frontend: [`frontend/src/app/entities/page.tsx`](../frontend/src/app/entities/page.tsx)  
Backend: `channel_analytics`, `client_analytics`, `user_analytics`, `team_analytics`, `multi_dimension`, `funnel`, `productivity`

### KPI Cards

- This page does not use the shared `KpiCard` component.
- Instead it embeds metric meaning directly in charts and tables.
- That is reasonable because entity analysis is comparison-heavy and summary-card-heavy design would add clutter.

This page is really four analytical workbenches sharing the same visual grammar.

### Channel Tab

#### Upload vs Processed vs Published

- Endpoint: `/channels/performance`
- Calculation:
  - uploaded = per-channel input count/duration
  - processed = per-channel distinct uploaded inputs that generated output
  - published = per-channel distinct uploaded inputs that generated published output
  - publish rate = `published/uploaded`
- Why this is good:
  - channel performance is measured at source-video grain, which is fair for channel comparison

#### Publish Rate by Channel

- Same endpoint
- Calculation:
  - uses `publish_rate_pct`
- Why this is good:
  - normalizes for volume

#### Channel x Output Type

- Endpoint: `/dimensions/double` with `channel x output_type`
- Calculation:
  - special dual-source output-type logic from `_combined_output_type_rows(...)`
- Why this is good:
  - preserves intended vs realized content type signal

#### Channel x Language Heatmap

- Endpoint: `/dimensions/heatmap` with `channel x language`
- Calculation:
  - uploaded input counts by channel/language
- Why this is good:
  - language coverage is most meaningful at intake

#### Channel Funnel Comparison

- Endpoint: `/funnel/by-dimension` with `channel`
- Calculation:
  - uploaded, processed, published counts and conversion
- Why this is good:
  - clean cross-channel operational comparison

#### Channel Activity Trends

- Endpoint: `/channels/trends`
- Calculation:
  - uploaded input count by channel and period
  - frontend keeps top channels only and pivots them into stacked series
- Why this is good:
  - avoids unreadable long-tail series clutter

#### Multi-Platform Reach

- Endpoint: `/productivity/platform-reach`
- Calculation:
  - per channel:
    - total publish events
    - distinct platforms used
    - `reach_score = platforms_used / total_platforms * 100`
- Why this is good:
  - reach is measured on actual publication surfaces, not on intent

#### Content Volume Treemap

- Endpoint: `/dimensions/double` with current channel cross-dimension
- Calculation:
  - each rectangle area = count for a channel/type pair
  - frontend also computes share of total
- Why this is good:
  - treemap is appropriate for concentration analysis

### Client Tab

#### Usage Distribution

- Endpoint: `/clients/usage-distribution`
- Calculation:
  - client share of uploaded volume
  - `share_pct = client_count / total_count * 100`
- Why this is good:
  - clean portfolio concentration metric

#### Client Upload vs Published

- Endpoint: `/clients/performance`
- Calculation:
  - uploaded_count vs published_count and publish_rate_pct
- Why this is good:
  - answers "who brings volume" and "who converts"

#### Client x Platform Distribution

- Endpoint: `/dimensions/double` with `client x platform`
- Calculation:
  - uploaded-input counts linked through publish surfaces when needed
- Why this is good:
  - reveals whether large clients are operationally diversified in distribution

#### Client x Output Type Heatmap

- Endpoint: `/dimensions/heatmap` with `client x output_type`
- Calculation:
  - same combined output-type logic
- Why this is good:
  - useful for client packaging strategy patterns

#### Client Funnel Comparison

- Endpoint: `/funnel/by-dimension` with `client`

#### Client Volume Trends

- Endpoint: `/clients/trends`
- Calculation:
  - uploaded count by client and period
  - frontend keeps top series only

#### Client x Platform Treemap

- Endpoint: `/dimensions/double`
- Calculation:
  - rectangle area = count for client/platform pair

### User Tab

#### User Productivity Scatter

- Endpoint: `/productivity/user-efficiency`
- Calculation:
  - x = uploads
  - y = publish_rate_pct
  - z/tooltip context = clips_per_upload, productivity_score
  - `productivity_score = uploads*0.3 + clips_per_upload*20 + publish_rate_pct*0.5`
- Why this is good:
  - scatter avoids collapsing volume and efficiency into one axis
- Honest upgrade ideas:
  - dominance analysis / efficient frontier labeling

#### Top User Rankings

- Endpoint: `/productivity/user-efficiency`
- Calculation:
  - sorted by `productivity_score`
- Why this is good:
  - uses an explicit formula rather than subjective ordering

#### User x Output Type

- Endpoint: `/dimensions/double` with `user x output_type`

#### User x Language Heatmap

- Endpoint: `/dimensions/heatmap` with `user x language`

#### Top User Radar

- Endpoint: `/productivity/user-efficiency`
- Frontend normalization:
  - uploads scaled by max selected uploads
  - score scaled by max selected score
  - clips/upload multiplied for display
- Why this is good:
  - radar is used for relative comparison, not raw metric reading

### Team Tab

#### Team Efficiency Radar

- Endpoint: `/productivity/team-efficiency`
- Same score logic as Executive Summary

#### Team x Output Type

- Endpoint: `/dimensions/double` with `team x output_type`

#### Team x Language Heatmap

- Endpoint: `/dimensions/heatmap` with `team x language`

#### Team Member Contribution

- Endpoint: `/teams/member-breakdown`
- Calculation:
  - scatter of per-member uploaded video count vs uploaded duration hours
- Why this is good:
  - separates raw quantity from workload size
- Honest upgrade ideas:
  - Gini coefficient for workload inequality per team

---

## 5. Data Quality Page

Frontend: [`frontend/src/app/quality/page.tsx`](../frontend/src/app/quality/page.tsx)  
Backend: [`app/routers/data_quality.py`](../app/routers/data_quality.py)

### KPI Cards

- No `KpiCard` components are used here.
- The page uses a custom hero score and metric strip instead.
- Those hero metrics are calculated from `/data-quality/story`:
  - `overall_score`
  - `affected_pct`
  - `total_errors`
  - `total_field_issues`
  - `duplicate_clusters`
- Why this is good:
  - the page needed a narrative command-center layout more than standard dashboard cards

This page is the most narrative-heavy and already has strong judge-facing framing.

### Trust Trajectory

- Frontend chart: `ComposedChart`
- Backend source: `/data-quality/story`
- Calculation:
  - monthly `quality_score`
  - monthly `error_events`
  - `quality_score = completeness_score*0.65 + reliability_score*0.35`
  - completeness score penalizes missing-field pressure
  - reliability score penalizes share of records affected by logged incidents
- Why this is good:
  - it combines structural metadata quality and operational incident quality
- Honest upgrade ideas:
  - EWMA control chart
  - separate latent trust index estimated by factor model

### Blast Radius by Channel

- Backend source: `/data-quality/story`
- Calculation:
  - `incident_index = affected_pct*0.7 + error_event_rate*0.3`, clamped to 0-100
- Why this is good:
  - ranks channels by impact, not by raw error count alone

### Error Genome

- Backend source: `/data-quality/story`
- Calculation:
  - error type distribution from `FactDataQuality`
  - counts and affected_records per error_type
- Why this is good:
  - pie is acceptable here because the point is composition of failure modes

### Field Integrity Radar

- Frontend: table, not a radar chart despite the title
- Backend source: `/data-quality/story`
- Calculation:
  - `fieldRisk = missing_pct*0.7 + unknown_pct*0.9`
- Why this is good:
  - unknown classifications are treated as slightly more corrosive than blanks

### Duplicate Pressure

- Backend source: `/data-quality/duplicates`
- Calculation:
  - duplicate cluster = input video ID appearing more than once
- Why this is good:
  - duplicates silently inflate nearly every downstream KPI

### Error Trends Over Time

- Backend endpoint: `/data-quality/trends`
- Calculation:
  - monthly logged error count by summing across error types in frontend
- Why this is good:
  - direct operational workload signal

### Logged Errors / Drilldown

- Tables, not charts, but analytically important

Judge-facing strength:

- this page already shows a clear leap from raw QA logging to operational trust scoring

---

## 6. Cross-Dimensional Explorer Page

Frontend: [`frontend/src/app/explorer/page.tsx`](../frontend/src/app/explorer/page.tsx)  
Backend: [`app/routers/multi_dimension.py`](../app/routers/video_explorer.py)

### KPI Cards

- No `KpiCard` components are used here.
- That is appropriate:
  - this page is exploratory and dimensional, not headline-metric driven

### Stacked Bar

- Endpoint: `/dimensions/double`
- Calculation:
  - counts by selected `dimension1 x dimension2`
  - frontend pivots rows into stacked bars
- Why this is good:
  - shows composition within each row dimension

### Heatmap

- Endpoint: `/dimensions/heatmap`
- Calculation:
  - count by selected dimension pair
  - frontend normalizes intensity as `value / max_value`
- Why this is good:
  - compact pattern discovery layer before drilldown

### Drilldown Table

- Endpoint: `/videos/search`
- Calculation:
  - clicked heatmap cell is translated back to dimension IDs
  - those IDs are inserted into filter fields like `channel_ids`, `language_ids`, etc.
- Why this is good:
  - proves the chart is operational, not decorative

### Treemap

- Endpoint: `/dimensions/double`
- Calculation:
  - area = count for selected pair
  - share_pct computed in frontend
- Why this is good:
  - efficient way to show concentration after selecting any arbitrary pair

Honest upgrade ideas for this whole page:

- association-rule mining for high-lift pairs
- correspondence analysis / MCA for latent structure
- clickthrough to semantic exemplars instead of just raw rows

---

## 7. Control Tower Page

Frontend: [`frontend/src/app/control-tower/page.tsx`](../frontend/src/app/control-tower/page.tsx)  
Backend: [`app/routers/intelligence.py`](../app/routers/operational_kpis.py)

This is the most "judge-wow" page already, because it layers second-order analytics on top of first-order KPIs.

### KPI Cards: Control Tower Summary

- Backend source: `/intelligence/control-tower`
- Frontend cards:
  - `Health Score`
  - `Recoverable Hours`
  - `Billable Upside`
  - `Avg Publish Rate`
- Calculation:
  - `Health Score` = mean channel health score
  - `Recoverable Hours` = sum of lost hours across tracked channels
  - `Billable Upside` = sum of recoverable billable hours across tracked channels
  - `Avg Publish Rate` = mean channel publish rate
- Why this is good:
  - these four cards compress a complex control-tower model into one executive read

### KPI Cards: Lost Value Engine Summary

- Backend source: `/intelligence/lost-value`
- Frontend cards:
  - `Stalled Outputs`
  - `Recoverable Hours`
  - `Avg Publish Latency`
- Calculation:
  - `Stalled Outputs = processed_outputs - published_outputs`
  - `Recoverable Hours = output_hours - published_hours`
  - `Avg Publish Latency = avg_process_to_publish_days`
- Why this is good:
  - each card is directly tied to the value leakage model and is easy to defend
- Honest upgrade ideas:
  - expected-value bands under scenario uncertainty

### Channel Health Leaderboard

- Backend source: `/intelligence/control-tower`
- Calculation:
  - channel rollup derives:
    - adoption_score
    - conversion_score
    - velocity_score
    - coverage_score
    - data_quality_score
  - `health_score = adoption*0.30 + conversion*0.25 + velocity*0.20 + coverage*0.15 + quality*0.10`
- Frontend chart:
  - stacked contribution bars use weighted components, not raw scores
- Why this is good:
  - weighted decomposition makes the composite explainable
- Honest upgrade ideas:
  - learn weights from historical business outcomes instead of hand-tuning

### Root-Cause Drivers

- Backend source: `/intelligence/control-tower`
- Calculation:
  - collects top gap rows from channel, team, language, and output_type dimensions
  - `share_of_gap_pct = gap_hours / total_gap_hours * 100`
- Why this is good:
  - focuses attention on what explains lost published inventory

### Value Waterfall

- Backend source: `/intelligence/lost-value`
- Calculation:
  - stages:
    - Processed Hours
    - Published Hours
    - Recoverable Hours = `output_hours - published_hours`
    - Billable Opportunity = `recoverable_hours * billable_rate_pct`
- Why this is good:
  - converts operational leakage into monetary/business language

### Client Leakage / Format Leakage

- Backend source: `/intelligence/lost-value`
- Calculation:
  - gap hours by client or output type
- Why this is good:
  - connects loss to where intervention can actually happen

### Behavioral Similarity Map

- Backend source: `/intelligence/peer-dna`
- Calculation:
  - candidate channels are featurized on uploads, outputs, published, publish rate, clip rate, platforms, languages, billable rate, inverse velocity, and top output-type mix shares
  - features are min-max normalized
  - pairwise cosine similarity is computed
  - each node is clustered by hand-coded archetype rules
  - edges are retained for top similar peers above threshold
- Why this is good:
  - this is a genuine higher-order analytical layer, not just another aggregation
- Honest upgrade ideas:
  - replace heuristic cluster labels with HDBSCAN or spectral clustering
  - use UMAP/t-SNE for layout initialization
  - learn peer recommendations via graph-based nearest-neighbor retrieval

### Peer Playbook Radar

- Backend source: `/intelligence/peer-dna` + `/intelligence/control-tower`
- Calculation:
  - compares selected node vs closest higher-performing peer across adoption, conversion, velocity, coverage, quality
- Why this is good:
  - it transforms similarity into an action model

### Scenario Simulator

- Not primarily a chart section, but a strong modeling component
- Calculation:
  - recovered outputs are estimated from publish uplift, velocity improvement, and active-user uplift, capped by current gap
- Honest upgrade ideas:
  - Monte Carlo simulation instead of fixed linear assumptions
  - causal uplift model from historical interventions

---

## 8. NLP Pipeline Page

Frontend: [`frontend/src/app/nlp-pipeline/page.tsx`](../frontend/src/app/nlp-pipeline/page.tsx)  
Backend: [`app/routers/nlp_pipeline.py`](../app/nlp/pipeline.py)

### KPI Cards

- No `KpiCard` components are used.
- The nearest equivalent is the information-response stat tiles:
  - response type
  - matched KPI count
- These are UI status cards, not analytical KPI cards.

### Visualization

- Frontend chart: dynamic `BarChart`
- Calculation:
  - after an NLP query returns tabular rows, the frontend:
    - picks the first column as the x-axis
    - detects numeric columns
    - renders each numeric column as a bar series
- Why this is good:
  - generic visualization layer for ad hoc analytical queries
- Limitation:
  - chart selection is heuristic and basic
- Honest upgrade ideas:
  - semantic chart recommendation from schema + result profile
  - automatic switch between line, bar, scatter, treemap based on measure/cardinality/time detection

---

## What Is Already Strong Enough To Impress Judges

The strongest truthful claims are:

- **Metric-grain discipline**: uploaded, processed, and published are not naively mixed.
- **Deduplication logic**: published-output charts use first-publish logic where uniqueness matters.
- **KPI discipline**: the headline cards are mostly ratios, composites, or rollups built from explicit operational primitives.
- **Operational explainability**: composites like health score and quality score are decomposed into interpretable parts.
- **Drilldown continuity**: explorer charts connect directly to row-level evidence.
- **Second-order analytics**: peer similarity, lost value, action queues, and quality narrative go beyond dashboard boilerplate.

## Where The Current System Is Still Basic

These are the places where the current implementation is solid but still relatively simple:

- most composites use hand-tuned weights
- most trend charts use averages, not distributions or percentiles
- anomaly logic is not deeply statistical
- peer clustering is heuristic, not learned
- chart recommendation in NLP is generic

## Best Honest "Next-Version" Sophistication Moves

If you want a high-end roadmap to present honestly as future or partial next-step work:

- Replace manual composite weights with learned weights tied to downstream success.
- Add forecast bands and anomaly detection via STL/Prophet/ETS instead of raw trend lines.
- Add percentile latency and queue modeling to pipeline velocity.
- Add concentration metrics:
  - entropy
  - HHI
  - Gini
- Upgrade peer intelligence:
  - UMAP embedding
  - HDBSCAN clustering
  - graph nearest-neighbor playbooks
- Upgrade explorer:
  - lift scores
  - standardized residuals
  - significance-aware heatmaps
- Upgrade quality:
  - control charts
  - latent trust model
  - issue recurrence prediction
- Upgrade scenario simulator:
  - Monte Carlo ranges
  - uncertainty intervals
  - elasticity learned from history

## Recommendation For Your Demo Narrative

The cleanest credible line is:

1. We model the pipeline at the correct business grain instead of using one naive count everywhere.
2. We prevent double counting by collapsing processed and published entities appropriately.
3. We then layer explainable operational intelligence on top: health scoring, lost-value estimation, peer benchmarking, and trust scoring.
4. The next phase is replacing heuristic weights with learned models and adding uncertainty-aware forecasting.

That is strong, technical, and defensible.

---

## Future Control Tower Implementation Plan

This is the strongest honest roadmap for making the Control Tower feel like a serious predictive operations layer.

### Strategic Framing

The best positioning is:

- current state: **explainable scenario simulator**
- next state: **calibrated predictive decision engine**

Suggested line:

- “We started with an interpretable scenario model so operators can trust the levers. The next phase is calibrating those levers with historical data, uncertainty estimation, and intervention learning.”

### Phase 1: Historical Prediction Foundation

Goal:

- turn the current rule-based simulator into a data-calibrated forecasting pipeline

Implementation:

- build a historical training dataset from pipeline snapshots over time
- define prediction targets:
  - probability an output gets published within 7, 14, and 30 days
  - expected process-to-publish latency
  - expected recoverable billable hours
- use existing warehouse-derived features:
  - publish rate
  - process-to-publish latency
  - output volume
  - platform reach
  - billable rate
  - language diversity
  - data-quality score
  - client/channel/team historical throughput
- benchmark interpretable baselines first:
  - logistic regression for publish likelihood
  - gradient boosted trees for latency and recoverable value

Judge-facing line:

- “We benchmark interpretable baselines before moving to heavier ML so the operating team can trust the system.”

### Phase 2: Uncertainty-Aware Forecasting

Goal:

- make forecast outputs credible instead of falsely precise

Implementation:

- return prediction intervals, not only point estimates
- add:
  - quantile regression
  - bootstrap confidence bands
  - Monte Carlo simulation over scenario inputs
- expose three forecast views:
  - conservative case
  - expected case
  - upside case

Judge-facing line:

- “Decision systems should expose uncertainty, not hide it.”

### Phase 3: Intervention Sensitivity Engine

Goal:

- identify which operational lever matters most for each entity

Implementation:

- run counterfactual simulations over levers like:
  - publish-rate uplift
  - process-to-publish latency improvement
  - active-user uplift
  - billable-rate uplift
- compute expected gain per lever
- rank interventions by projected ROI and operational feasibility

Outputs:

- best next action
- expected upside
- confidence level

Judge-facing line:

- “The platform does not just forecast outcomes; it ranks the interventions most likely to improve them.”

### Phase 4: Peer-Learned Recommendations

Goal:

- connect prediction to behavioral benchmarking

Implementation:

- use the existing Peer DNA graph as a retrieval layer
- for each underperforming workspace:
  - retrieve nearest higher-performing peers
  - compare feature deltas
  - infer likely improvement levers
- learn recommendation heuristics from historical peer transitions over time

Judge-facing line:

- “We combine forecasting with analog-based playbooks from operationally similar high-performing peers.”

### Phase 5: Real-Time Control Tower Scoring

Goal:

- move from snapshot analytics to continuous predictive monitoring

Implementation:

- scheduled scoring jobs
- rolling entity-level forecasts
- alerting for:
  - rising publish-risk probability
  - velocity degradation
  - sudden recoverable-value spikes
- persist model outputs so the UI can show:
  - current health
  - forward risk outlook
  - recommended intervention
  - last model refresh

Judge-facing line:

- “The dashboard becomes a forward-looking operating system rather than a rear-view report.”

### Technical Architecture

#### Data Layer

- daily snapshot tables for channel/client/team health
- historical intervention log
- feature store for model-ready metrics
- prediction-output table with timestamps and model versioning

#### Modeling Layer

- baseline model registry
- batch training pipeline
- backtesting and drift monitoring
- scenario-simulation service wrapping trained models

#### Product Layer

- confidence bands on forecast cards
- intervention ranking panel
- “why this forecast” explainer using feature contribution scores
- model version and last refresh metadata in the UI

### Metrics To Track

These make the roadmap sound technically serious and evaluable:

- AUC / PR-AUC for publish-likelihood prediction
- MAE / RMSE for latency prediction
- calibration error for probability outputs
- uplift capture for intervention ranking
- forecast stability across adjacent windows
- operator adoption rate of recommended actions

### Best Judge-Friendly Narrative

1. Today’s Control Tower uses an explainable scenario engine grounded in real pipeline constraints.
2. The next version calibrates those levers on historical data to become a data-driven forecasting layer.
3. It adds uncertainty bands so leaders see outcome ranges instead of fake precision.
4. It then ranks interventions by predicted ROI and ties them to peer-derived playbooks.

### Strong Closing Line

- “The roadmap is from descriptive dashboard to predictive operating layer: forecast risk, quantify upside, recommend action, and explain why.”
