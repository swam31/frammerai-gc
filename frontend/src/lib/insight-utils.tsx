"use client";

import React from "react";
import type { InsightItem } from "@/components/ui/InsightPanel";

type InsightContext = {
  data?: Array<Record<string, unknown>>;
  labelKey?: string;
  valueKeys?: string[];
};

type KpiInsightModel = {
  headline: string;
  status: string;
  statusTone: InsightItem["type"];
  sections: Array<{
    label: string;
    text: string;
    tone: InsightItem["type"];
  }>;
};

const LABEL_CANDIDATES = [
  "name",
  "label",
  "title",
  "period",
  "stage",
  "client",
  "channel",
  "team",
  "user",
  "language",
  "platform",
  "category",
  "output_type",
  "input_type",
  "dimension_label",
  "client_name",
  "channel_name",
  "team_name",
  "user_name",
  "entity_name",
  "error_type",
  "field_name",
];

function getElementName(type: unknown): string {
  if (typeof type === "string") return type;
  return (type as { displayName?: string; name?: string }).displayName ??
    (type as { displayName?: string; name?: string }).name ??
    "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatMetric(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatDisplayValue(value: number, suffix?: string): string {
  return `${formatMetric(value)}${suffix ?? ""}`;
}

function inferLabelKey(
  data: Array<Record<string, unknown>>,
  explicit?: string,
): string | undefined {
  if (explicit) return explicit;
  const firstRow = data[0];
  if (!firstRow) return undefined;

  for (const candidate of LABEL_CANDIDATES) {
    if (candidate in firstRow) return candidate;
  }

  return Object.keys(firstRow).find((key) => {
    const value = firstRow[key];
    return typeof value === "string" && Number.isNaN(Number(value));
  });
}

function inferValueKeys(
  data: Array<Record<string, unknown>>,
  explicit?: string[],
  labelKey?: string,
): string[] {
  if (explicit && explicit.length > 0) return Array.from(new Set(explicit));
  const firstRow = data[0];
  if (!firstRow) return [];

  return Object.keys(firstRow).filter((key) => {
    if (key === labelKey) return false;
    return toNumber(firstRow[key]) !== null;
  });
}

function extractSeriesContext(children: React.ReactNode): InsightContext {
  const context: InsightContext = { valueKeys: [] };
  const SERIES_ELEMENTS = new Set([
    "Area",
    "Bar",
    "Line",
    "Pie",
    "Radar",
    "Scatter",
    "Treemap",
  ]);

  const visit = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;

      const props = child.props as {
        children?: React.ReactNode;
        data?: unknown;
        dataKey?: unknown;
        nameKey?: unknown;
        type?: unknown;
      };
      const elementName = getElementName(child.type);

      if (!context.data && Array.isArray(props.data)) {
        context.data = props.data as Array<Record<string, unknown>>;
      }

      if (!context.labelKey && typeof props.nameKey === "string") {
        context.labelKey = props.nameKey;
      }

      if (
        !context.labelKey &&
        typeof props.dataKey === "string" &&
        (props.type === "category" ||
          elementName === "XAxis" ||
          elementName === "YAxis")
      ) {
        context.labelKey = props.dataKey;
      }

      if (
        typeof props.dataKey === "string" &&
        SERIES_ELEMENTS.has(elementName) &&
        !["name", "label", "period", "stage"].includes(props.dataKey)
      ) {
        context.valueKeys?.push(props.dataKey);
      }

      if (props.children) {
        visit(props.children);
      }
    });
  };

  visit(children);
  if (context.valueKeys) {
    context.valueKeys = Array.from(new Set(context.valueKeys));
  }
  return context;
}

function buildDistributionInsights(
  title: string,
  data: Array<Record<string, unknown>>,
  labelKey: string,
  valueKey: string,
): InsightItem[] {
  const rows = data
    .map((row) => ({
      label: String(row[labelKey] ?? "Unknown"),
      value: toNumber(row[valueKey]) ?? 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) return [];

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const leader = rows[0];
  const runnerUp = rows[1];
  const leaderShare = total > 0 ? (leader.value / total) * 100 : 0;
  const topThreeShare =
    total > 0
      ? (rows.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / total) *
        100
      : 0;

  const items: InsightItem[] = [
    {
      label: "Concentration",
      type: leaderShare >= 45 ? "warning" : "positive",
      text: `${leader.label} leads ${title.toLowerCase()} with ${formatMetric(leader.value)} units, accounting for ${leaderShare.toFixed(1)}% of the visible total.`,
    },
    {
      label: "Portfolio Shape",
      type: topThreeShare >= 70 ? "warning" : "neutral",
      text:
        topThreeShare >= 70
          ? `The top three slices already absorb ${topThreeShare.toFixed(1)}% of volume, which means the story here is concentration rather than spread.`
          : `The top three slices account for ${topThreeShare.toFixed(1)}% of volume, suggesting the mix is reasonably diversified instead of riding on a single bucket.`,
    },
  ];

  if (runnerUp) {
    items.push({
      label: "Competitive Gap",
      type:
        leader.value >= runnerUp.value * 1.6 ? "warning" : "positive",
      text: `${leader.label} is ${formatMetric(leader.value - runnerUp.value)} units ahead of ${runnerUp.label}, so this chart reads as a clear strategic winner rather than a crowded field.`,
    });
  } else {
    items.push({
      label: "Decision Read",
      type: "neutral",
      text: "Only one meaningful category is present in the current slice, so the operational takeaway is dominance, not comparison.",
    });
  }

  return items;
}

function buildPipelineInsights(
  data: Array<Record<string, unknown>>,
  labelKey: string,
  uploadedKey: string,
  processedKey: string | undefined,
  publishedKey: string,
): InsightItem[] {
  const totals = data.reduce<{
    uploaded: number;
    processed: number;
    published: number;
  }>(
    (acc, row) => {
      acc.uploaded += toNumber(row[uploadedKey]) ?? 0;
      acc.processed += processedKey ? toNumber(row[processedKey]) ?? 0 : 0;
      acc.published += toNumber(row[publishedKey]) ?? 0;
      return acc;
    },
    { uploaded: 0, processed: 0, published: 0 },
  );

  const ranked = data
    .map((row) => ({
      label: String(row[labelKey] ?? "Unknown"),
      uploaded: toNumber(row[uploadedKey]) ?? 0,
      processed: processedKey ? toNumber(row[processedKey]) ?? 0 : 0,
      published: toNumber(row[publishedKey]) ?? 0,
    }))
    .sort((a, b) => (b.uploaded - b.published) - (a.uploaded - a.published));

  const uploadToPublish =
    totals.uploaded > 0 ? (totals.published / totals.uploaded) * 100 : 0;
  const processToPublish =
    totals.processed > 0 ? (totals.published / totals.processed) * 100 : 0;
  const leader = ranked[0];

  return [
    {
      label: "Conversion Story",
      type: uploadToPublish >= 55 ? "positive" : uploadToPublish >= 35 ? "warning" : "critical",
      text: `Across the visible cohort, ${uploadToPublish.toFixed(1)}% of uploaded volume survives all the way to published output${processedKey ? `, while processed-to-published conversion sits at ${processToPublish.toFixed(1)}%` : ""}.`,
    },
    {
      label: "Primary Leak",
      type: leader && leader.uploaded - leader.published > 0 ? "critical" : "neutral",
      text:
        leader && leader.uploaded - leader.published > 0
          ? `${leader.label} shows the largest visible drop, leaving ${formatMetric(leader.uploaded - leader.published)} units stranded between intake and audience delivery.`
          : "The current slice does not show a pronounced leakage pocket, which means the main story is throughput rather than fallout.",
    },
    {
      label: "Decision Read",
      type: "neutral",
      text: "This chart works best as an efficiency proof: it reveals whether scale is actually reaching the audience or just swelling the middle of the pipeline.",
    },
  ];
}

function buildRateInsights(
  title: string,
  data: Array<Record<string, unknown>>,
  labelKey: string,
  valueKey: string,
): InsightItem[] {
  const rows = data
    .map((row) => ({
      label: String(row[labelKey] ?? "Unknown"),
      value: toNumber(row[valueKey]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) return [];

  const avg =
    rows.reduce((sum, row) => sum + row.value, 0) / Math.max(rows.length, 1);
  const leader = rows[0];
  const laggard = rows[rows.length - 1];

  return [
    {
      label: "Benchmark",
      type: avg >= 60 ? "positive" : avg >= 35 ? "warning" : "critical",
      text: `The visible average for ${title.toLowerCase()} is ${avg.toFixed(1)}%, with ${leader.label} setting the pace at ${leader.value.toFixed(1)}%.`,
    },
    {
      label: "Spread",
      type:
        leader.value - laggard.value >= 25 ? "warning" : "neutral",
      text: `${laggard.label} trails the leader by ${(leader.value - laggard.value).toFixed(1)} points, which means execution consistency is still a larger challenge than top-end performance.`,
    },
    {
      label: "Executive Angle",
      type: "neutral",
      text: "This reads as a discipline metric: strong leaders prove the workflow can work, while the long tail shows whether that behavior is repeatable.",
    },
  ];
}

function buildTrendInsights(
  title: string,
  data: Array<Record<string, unknown>>,
  labelKey: string,
  valueKey: string,
): InsightItem[] {
  const rows = data
    .map((row) => ({
      label: String(row[labelKey] ?? "Unknown"),
      value: toNumber(row[valueKey]) ?? 0,
    }))
    .filter((row) => Number.isFinite(row.value));

  if (rows.length < 2) return [];

  const first = rows[0];
  const last = rows[rows.length - 1];
  const peak = rows.reduce((best, row) => (row.value > best.value ? row : best));
  const change = last.value - first.value;
  const changePct = first.value !== 0 ? (change / first.value) * 100 : 0;
  const positiveRuns = rows.slice(1).filter((row, index) => row.value >= rows[index].value).length;

  return [
    {
      label: "Momentum",
      type: change > 0 ? "positive" : change < 0 ? "warning" : "neutral",
      text: `${title} moves from ${formatMetric(first.value)} in ${first.label} to ${formatMetric(last.value)} in ${last.label}, a ${change >= 0 ? "gain" : "decline"} of ${Math.abs(changePct).toFixed(1)}% across the selected window.`,
    },
    {
      label: "Peak Signal",
      type: "neutral",
      text: `${peak.label} marks the visible peak at ${formatMetric(peak.value)}, which becomes the natural benchmark for the rest of the run.`,
    },
    {
      label: "Shape",
      type: positiveRuns >= Math.floor(rows.length / 2) ? "positive" : "warning",
      text:
        positiveRuns >= Math.floor(rows.length / 2)
          ? "Most step changes are flat-to-up, so the line reads as compounding traction rather than a one-off spike."
          : "The line changes direction frequently, which suggests the story is volatility and inconsistency rather than clean sustained growth.",
    },
  ];
}

function buildHeatmapInsights(
  data: Array<Record<string, unknown>>,
): InsightItem[] {
  const cells = data
    .map((row) => ({
      x: String(row.x ?? row.dim1_label ?? "Unknown"),
      y: String(row.y ?? row.dim2_label ?? "Unknown"),
      value: toNumber(row.value ?? row.count) ?? 0,
    }))
    .filter((cell) => cell.value > 0);

  if (cells.length === 0) return [];

  const peak = cells.reduce((best, cell) => (cell.value > best.value ? cell : best));
  const xCount = new Set(cells.map((cell) => cell.x)).size;
  const yCount = new Set(cells.map((cell) => cell.y)).size;
  const fillRate =
    xCount * yCount > 0 ? (cells.length / (xCount * yCount)) * 100 : 0;

  return [
    {
      label: "Hottest Cell",
      type: peak.value > 0 ? "warning" : "neutral",
      text: `${peak.x} x ${peak.y} is the strongest visible intersection at ${formatMetric(peak.value)} units, so that pairing is defining the map rather than merely participating in it.`,
    },
    {
      label: "Coverage",
      type: fillRate >= 55 ? "positive" : "warning",
      text:
        fillRate >= 55
          ? `${fillRate.toFixed(1)}% of possible intersections are active, which points to broad operational coverage instead of isolated pockets of activity.`
          : `Only ${fillRate.toFixed(1)}% of possible intersections are active, which means specialization is strong and white space is still substantial.`,
    },
    {
      label: "Decision Read",
      type: "neutral",
      text: "This view exposes hidden operating DNA: it shows whether volume is broadly distributed across combinations or trapped in a few repeatable pairings.",
    },
  ];
}

function buildScatterInsights(
  data: Array<Record<string, unknown>>,
  xKey: string,
  yKey: string,
): InsightItem[] {
  const points = data
    .map((row) => ({
      x: toNumber(row[xKey]) ?? 0,
      y: toNumber(row[yKey]) ?? 0,
      label: String(
        row.user_name ??
          row.entity_name ??
          row.team_name ??
          row.channel_name ??
          "Unknown",
      ),
    }))
    .filter((point) => point.x > 0 || point.y > 0);

  if (points.length === 0) return [];

  const avgX =
    points.reduce((sum, point) => sum + point.x, 0) / Math.max(points.length, 1);
  const avgY =
    points.reduce((sum, point) => sum + point.y, 0) / Math.max(points.length, 1);
  const topRight = points.filter((point) => point.x >= avgX && point.y >= avgY);
  const standout = points.reduce((best, point) =>
    point.x * point.y > best.x * best.y ? point : best,
  );

  return [
    {
      label: "Standout Operator",
      type: "positive",
      text: `${standout.label} sits furthest into the high-volume, high-performance quadrant, making it the clearest proof point that this workflow can scale without sacrificing quality.`,
    },
    {
      label: "Quadrant Mix",
      type: topRight.length >= Math.max(2, Math.floor(points.length * 0.25)) ? "positive" : "warning",
      text:
        topRight.length >= Math.max(2, Math.floor(points.length * 0.25))
          ? `${topRight.length} operators are already above the average on both axes, so excellence is becoming a pattern instead of a single-person exception.`
          : `Only ${topRight.length} operators sit above the average on both axes, which means performance is still concentrated in a very small leadership group.`,
    },
    {
      label: "Decision Read",
      type: "neutral",
      text: "Scatter views are persuasive because they separate raw activity from effectiveness; the key question is not who works the most, but who converts effort into outcomes.",
    },
  ];
}

function buildFallbackInsights(title: string, description?: string): InsightItem[] {
  const lowerTitle = title.toLowerCase();
  const isTrend =
    lowerTitle.includes("trend") ||
    lowerTitle.includes("trajectory") ||
    lowerTitle.includes("growth") ||
    lowerTitle.includes("velocity") ||
    lowerTitle.includes("over time");
  const isDistribution =
    lowerTitle.includes("distribution") ||
    lowerTitle.includes("mix") ||
    lowerTitle.includes("treemap") ||
    lowerTitle.includes("heatmap");
  const isRanking =
    lowerTitle.includes("table") ||
    lowerTitle.includes("leaderboard") ||
    lowerTitle.includes("results") ||
    lowerTitle.includes("board");

  const story = description
    ? description.trim()
    : "This panel translates operational raw data into a story stakeholders can read quickly.";

  if (isTrend) {
    return [
      {
        label: "Narrative",
        type: "neutral",
        text: `${story} The real signal is whether the curve is compounding, flattening, or oscillating.`,
      },
      {
        label: "What To Watch",
        type: "warning",
        text: "The first thing most readers look for is widening gaps between periods, because that is where momentum either proves itself or breaks down.",
      },
      {
        label: "Executive Angle",
        type: "neutral",
        text: "A clean upward shape reads as operational control; a noisy shape reads as dependency on one-off bursts.",
      },
    ];
  }

  if (isDistribution) {
    return [
      {
        label: "Narrative",
        type: "neutral",
        text: `${story} The core question here is whether the portfolio is balanced or overly dependent on a few dominant buckets.`,
      },
      {
        label: "What To Watch",
        type: "warning",
        text: "Heavy concentration can create short-term efficiency, but it also reveals fragility if strategy or demand shifts.",
      },
      {
        label: "Executive Angle",
        type: "neutral",
        text: "The strongest presentation is a mix that looks intentional, not accidental.",
      },
    ];
  }

  if (isRanking) {
    return [
      {
        label: "Narrative",
        type: "neutral",
        text: `${story} This card is doing decision-support work: it shows who leads, who lags, and where intervention will matter fastest.`,
      },
      {
        label: "What To Watch",
        type: "warning",
        text: "The biggest gaps are usually more important than the top rank because they reveal where operational drag is concentrated.",
      },
      {
        label: "Executive Angle",
        type: "neutral",
        text: "This reads as proof that the product is not only descriptive, but prioritizes action.",
      },
    ];
  }

  return [
    {
      label: "Narrative",
      type: "neutral",
      text: `${story} This view exists to turn raw telemetry into a decision, not just a display.`,
    },
    {
      label: "What To Watch",
      type: "warning",
      text: "The most persuasive interpretation is the gap between top performance and the rest of the field, because that is where repeatability gets tested.",
    },
    {
      label: "Executive Angle",
      type: "neutral",
      text: "The strongest charts make the next move obvious; this panel should read as a diagnostic, not decoration.",
    },
  ];
}

export function buildChartInsights({
  title,
  description,
  context,
}: {
  title: string;
  description?: string;
  context?: InsightContext;
}): InsightItem[] {
  const lowerTitle = title.toLowerCase();
  const extractedData = context?.data ?? [];
  const labelKey =
    extractedData.length > 0
      ? inferLabelKey(extractedData, context?.labelKey)
      : context?.labelKey;
  const valueKeys =
    extractedData.length > 0
      ? inferValueKeys(extractedData, context?.valueKeys, labelKey)
      : context?.valueKeys ?? [];

  if (lowerTitle.includes("heatmap") && extractedData.length > 0) {
    const heatmapInsights = buildHeatmapInsights(extractedData);
    if (heatmapInsights.length > 0) return heatmapInsights;
  }

  if (
    lowerTitle.includes("scatter") &&
    extractedData.length > 0 &&
    valueKeys.length >= 2
  ) {
    const scatterInsights = buildScatterInsights(
      extractedData,
      valueKeys[0],
      valueKeys[1],
    );
    if (scatterInsights.length > 0) return scatterInsights;
  }

  if (extractedData.length > 0 && labelKey && valueKeys.length > 0) {
    const uploadedKey = valueKeys.find((key) => key.includes("upload"));
    const processedKey = valueKeys.find((key) => key.includes("process"));
    const publishedKey = valueKeys.find((key) => key.includes("publish"));
    const rateKey = valueKeys.find(
      (key) => key.includes("rate") || key.includes("pct"),
    );
    const trendKey =
      valueKeys.find(
        (key) =>
          key.toLowerCase() === "value" ||
          key.toLowerCase() === "count" ||
          key.toLowerCase().includes("score") ||
          key.toLowerCase().includes("throughput"),
      ) ?? valueKeys[0];

    if (uploadedKey && publishedKey) {
      return buildPipelineInsights(
        extractedData,
        labelKey,
        uploadedKey,
        processedKey,
        publishedKey,
      );
    }

    if (rateKey && (lowerTitle.includes("rate") || lowerTitle.includes("%"))) {
      const rateInsights = buildRateInsights(
        title,
        extractedData,
        labelKey,
        rateKey,
      );
      if (rateInsights.length > 0) return rateInsights;
    }

    if (
      lowerTitle.includes("distribution") ||
      lowerTitle.includes("mix") ||
      lowerTitle.includes("treemap") ||
      lowerTitle.includes("results") ||
      lowerTitle.includes("leaderboard") ||
      lowerTitle.includes("board")
    ) {
      const distributionInsights = buildDistributionInsights(
        title,
        extractedData,
        labelKey,
        trendKey,
      );
      if (distributionInsights.length > 0) return distributionInsights;
    }

    if (
      lowerTitle.includes("trend") ||
      lowerTitle.includes("trajectory") ||
      lowerTitle.includes("over time") ||
      lowerTitle.includes("growth") ||
      lowerTitle.includes("velocity")
    ) {
      const trendInsights = buildTrendInsights(
        title,
        extractedData,
        labelKey,
        trendKey,
      );
      if (trendInsights.length > 0) return trendInsights;
    }

    if (valueKeys.length === 1) {
      const singleMetricInsights = buildDistributionInsights(
        title,
        extractedData,
        labelKey,
        valueKeys[0],
      );
      if (singleMetricInsights.length > 0) return singleMetricInsights;
    }
  }

  return buildFallbackInsights(title, description);
}

function classifyKpi(title: string, suffix?: string): {
  lowerIsBetter: boolean;
  category:
    | "speed"
    | "risk"
    | "coverage"
    | "quality"
    | "rate"
    | "financial"
    | "volume";
} {
  const lower = title.toLowerCase();

  if (
    lower.includes("latency") ||
    lower.includes("days") ||
    lower.includes("time") ||
    lower.includes("velocity")
  ) {
    return { lowerIsBetter: true, category: "speed" };
  }

  if (
    lower.includes("dropout") ||
    lower.includes("stalled") ||
    lower.includes("lost") ||
    lower.includes("gap") ||
    lower.includes("leak") ||
    lower.includes("pressure") ||
    lower.includes("error")
  ) {
    return { lowerIsBetter: true, category: "risk" };
  }

  if (
    lower.includes("quality") ||
    lower.includes("health") ||
    lower.includes("trust") ||
    lower.includes("completeness") ||
    lower.includes("score")
  ) {
    return { lowerIsBetter: false, category: "quality" };
  }

  if (
    lower.includes("billable") ||
    lower.includes("recoverable") ||
    lower.includes("value")
  ) {
    return { lowerIsBetter: false, category: "financial" };
  }

  if (
    lower.includes("client") ||
    lower.includes("user") ||
    lower.includes("channel") ||
    lower.includes("platform") ||
    lower.includes("language") ||
    lower.includes("reach") ||
    lower.includes("coverage")
  ) {
    return { lowerIsBetter: false, category: "coverage" };
  }

  if (suffix === "%" || lower.includes("rate") || lower.includes("score")) {
    return { lowerIsBetter: false, category: "rate" };
  }

  return { lowerIsBetter: false, category: "volume" };
}

function describeBand(
  value: number,
  suffix: string | undefined,
  category: "speed" | "risk" | "coverage" | "quality" | "rate" | "financial" | "volume",
  lowerIsBetter: boolean,
): {
  label: string;
  tone: InsightItem["type"];
  interpretation: string;
} {
  if (category === "volume") {
    return {
      label: "Scale signal",
      tone: "neutral",
      interpretation:
        "This is a raw scale number, so the right question is not whether it is inherently high or low, but whether the rest of the system is converting it into outcomes.",
    };
  }

  if (suffix === "%") {
    if (lowerIsBetter) {
      if (value <= 10) {
        return {
          label: "Contained risk",
          tone: "positive",
          interpretation:
            "The percentage is tightly controlled, which signals disciplined execution and limited leakage.",
        };
      }
      if (value <= 25) {
        return {
          label: "Manageable pressure",
          tone: "warning",
          interpretation:
            "The percentage is still workable, but it is large enough to leave visible efficiency on the table.",
        };
      }
      return {
        label: "Visible drag",
        tone: "critical",
        interpretation:
          "The percentage is large enough to become part of the product story for the wrong reasons, because too much value is escaping the workflow.",
      };
    }

    if (value >= 80) {
      return {
        label: "Elite conversion",
        tone: "positive",
        interpretation:
          "This is operating at a level that reads as repeatable excellence rather than a lucky spike.",
      };
    }
    if (value >= 60) {
      return {
        label: "Healthy performance",
        tone: "positive",
        interpretation:
          "The number is strong enough to prove the workflow works, even if there is still room to sharpen consistency.",
      };
    }
    if (value >= 40) {
      return {
        label: "Middle band",
        tone: "warning",
        interpretation:
          "The workflow is functioning, but not with enough authority to feel dominant.",
      };
    }
    return {
      label: "Underperforming",
      tone: "critical",
      interpretation:
        "The number is weak enough that readers will infer friction, inconsistency, or poor operational follow-through.",
    };
  }

  if (suffix === "days") {
    if (value <= 2) {
      return {
        label: "Fast handoff",
        tone: "positive",
        interpretation:
          "The cycle time is short enough to suggest a well-connected workflow with minimal queueing delay.",
      };
    }
    if (value <= 5) {
      return {
        label: "Acceptable pace",
        tone: "warning",
        interpretation:
          "The handoff is workable, but there is enough waiting time here to slow perceived responsiveness.",
      };
    }
    return {
      label: "Slow cycle",
      tone: "critical",
      interpretation:
        "The delay is long enough to read as systemic drag rather than normal processing time.",
    };
  }

  if (suffix === "x") {
    if (value >= 2) {
      return {
        label: "Strong multiplier",
        tone: "positive",
        interpretation:
          "Each unit of effort is being turned into multiple downstream assets, which is exactly the kind of leverage stakeholders want to see.",
      };
    }
    if (value >= 1) {
      return {
        label: "Useful leverage",
        tone: "warning",
        interpretation:
          "The system is generating more than one downstream outcome per input, but not yet at a level that feels defensibly exceptional.",
      };
    }
    return {
      label: "Weak leverage",
      tone: "critical",
      interpretation:
        "The multiplier is too low to argue that the pipeline is extracting enough value from each source asset.",
    };
  }

  if (category === "coverage" || category === "financial") {
    return {
      label: value > 0 ? "Expanding footprint" : "Dormant footprint",
      tone: value > 0 ? "positive" : "warning",
      interpretation:
        value > 0
          ? "The metric shows real operating footprint, which matters because scale and reach are visible even before someone inspects the detail."
          : "The metric is too thin to create a convincing scale narrative on its own.",
    };
  }

  return {
    label: "Operational signal",
    tone: "neutral",
    interpretation:
      "This number matters because it captures whether the operating model is functioning with discipline, not just activity.",
  };
}

function metricSpecificNarrative(
  title: string,
  category: "speed" | "risk" | "coverage" | "quality" | "rate" | "financial" | "volume",
  lowerIsBetter: boolean,
): {
  whyItMatters: string;
  executiveLens: string;
  actionCue: string;
} {
  const lower = title.toLowerCase();

  if (lower.includes("publish")) {
    return {
      whyItMatters:
        "Publishing metrics are where effort meets audience. They show whether production output is actually crossing the finish line instead of accumulating in backlog.",
      executiveLens:
        "This reads as proof of execution discipline, because strong publish behavior suggests the system is operationally complete, not just generative.",
      actionCue:
        lowerIsBetter
          ? "Remove approval or scheduling friction that keeps finished work waiting."
          : "Lift the middle of the pack so strong publish behavior becomes standard, not concentrated in a few entities.",
    };
  }

  if (lower.includes("billable") || lower.includes("value")) {
    return {
      whyItMatters:
        "Value-capture metrics matter because they turn operational performance into commercial performance. They prove the pipeline is not just busy, but economically meaningful.",
      executiveLens:
        "A strong number here makes the dashboard feel monetization-aware rather than purely descriptive.",
      actionCue:
        "Focus on the highest-value leakage pocket first, because recovering trapped value is usually faster than creating new volume from scratch.",
    };
  }

  if (lower.includes("translation") || lower.includes("language")) {
    return {
      whyItMatters:
        "Localization metrics show whether the system can expand reach without rebuilding the workflow for every audience.",
      executiveLens:
        "This reads as a multiplier on audience access and catalog efficiency, not just a content formatting detail.",
      actionCue:
        "Double down on the language or translation paths that already convert well, then standardize the process around them.",
    };
  }

  if (lower.includes("platform") || lower.includes("saturation") || lower.includes("reach")) {
    return {
      whyItMatters:
        "Coverage metrics reveal whether the operating model is broad enough to distribute value across surfaces, not just generate it in one lane.",
      executiveLens:
        "This is one of the fastest ways to communicate strategic breadth.",
      actionCue:
        "Look for dormant entities or missing destinations before expanding the funnel elsewhere.",
    };
  }

  if (lower.includes("quality") || lower.includes("health") || lower.includes("completeness") || lower.includes("trust")) {
    return {
      whyItMatters:
        "Trust metrics stabilize the rest of the dashboard. When quality is weak, every downstream KPI becomes easier to challenge.",
      executiveLens:
        "Strong quality numbers give the rest of the analytics layer more credibility.",
      actionCue:
        "Attack the noisiest failure mode first, because trust improves fastest when the most visible weakness disappears.",
    };
  }

  if (lower.includes("reuse") || lower.includes("repurposing") || lower.includes("multiplication") || lower.includes("compression")) {
    return {
      whyItMatters:
        "Yield metrics show how much additional value the system can squeeze from a single source asset, which is central to the product's leverage story.",
      executiveLens:
        "High leverage here makes the entire platform feel capital-efficient and editorially intelligent.",
      actionCue:
        "Codify the strongest high-yield workflow and spread it to lower-performing operators before chasing more input volume.",
    };
  }

  if (category === "speed") {
    return {
      whyItMatters:
        "Cycle-time metrics expose hidden queueing and handoff friction. They are often the cleanest signal of whether the workflow feels truly operational or merely functional.",
      executiveLens:
        "Speed reads as product maturity, because short, reliable handoffs imply the system can perform under real pressure.",
      actionCue:
        "Shorten the slowest handoff first, because downstream benefits usually compound from a single delay reduction.",
    };
  }

  if (category === "risk") {
    return {
      whyItMatters:
        "Leakage metrics matter because every lost unit here dilutes the value created upstream.",
      executiveLens:
        "A weak number in this family attracts attention quickly because it suggests the workflow is generating waste, not just work.",
      actionCue:
        "Concentrate on the single largest failure pocket rather than spreading effort thinly across many minor defects.",
    };
  }

  if (category === "coverage") {
    return {
      whyItMatters:
        "Coverage metrics reveal whether adoption is broad and durable enough to make the platform feel systemic rather than localized.",
      executiveLens:
        "Broad coverage reads as product gravity: more surfaces, more operators, and more proof that the system is actually in use.",
      actionCue:
        "Expand usage where there is dormant capacity before trying to add complexity or net-new scope.",
    };
  }

  if (category === "financial") {
    return {
      whyItMatters:
        "Financially oriented KPIs connect operational execution to actual business value, which is where analytics starts to feel decisive.",
      executiveLens:
        "These are often the most memorable cards because they answer the implied question: why does this dashboard matter commercially?",
      actionCue:
        "Make the fastest path to captured value explicit and measurable.",
    };
  }

  return {
    whyItMatters:
      "This metric matters because it compresses a complex operating behavior into a single number that can be monitored and improved.",
    executiveLens:
      "This acts as shorthand for whether the system behaves with repeatability rather than one-off brilliance.",
    actionCue:
      lowerIsBetter
        ? "Reduce the number without breaking the rest of the system."
        : "Push the number up by making the strongest behavior repeatable across the cohort.",
  };
}

function buildKpiHeadline(
  title: string,
  formattedValue: string,
  category: "speed" | "risk" | "coverage" | "quality" | "rate" | "financial" | "volume",
  lowerIsBetter: boolean,
  band: { label: string; tone: InsightItem["type"]; interpretation: string },
): string {
  const lower = title.toLowerCase();

  if (lower.includes("uploaded")) {
    return `${formattedValue} source videos entered the pipeline in the selected window. That gives the system real top-of-funnel mass, but the important question is how much of that intake survives into processed and published output.`;
  }

  if (lower.includes("processed")) {
    return `${formattedValue} videos made it through processing. This is the size of the pipeline's productive middle, and it becomes convincing only when publish behavior keeps pace with creation.`;
  }

  if (lower.includes("published")) {
    return `${formattedValue} videos reached an audience-facing endpoint. This is the cleanest proof that the workflow is converting internal effort into delivered output.`;
  }

  if (lower.includes("publish rate")) {
    return `${title} is ${formattedValue}. That number answers the simplest operational question on the page: how often finished work actually crosses the line instead of stalling in workflow.`;
  }

  if (lower.includes("active client")) {
    return `${formattedValue} clients were active in the selected slice. That is a direct read on account penetration and whether usage is broad enough to feel systemic instead of concentrated in a handful of relationships.`;
  }

  if (lower.includes("active user")) {
    return `${formattedValue} users contributed activity in the current window. The number matters because it reflects how widely the operating model is adopted across the team, not just how much volume a few power users generate.`;
  }

  if (lower.includes("active channel")) {
    return `${formattedValue} channels showed activity. That is a practical breadth signal: it shows whether the system is distributed across the publishing network or clustered in a narrow operating lane.`;
  }

  if (lower.includes("platform")) {
    return `${formattedValue} platforms are active in the current slice. That makes this KPI a direct signal of distribution breadth rather than pure production volume.`;
  }

  if (lower.includes("language")) {
    return `${formattedValue} languages are in active use. This is a breadth-and-localization signal showing how far the system can travel without requiring a separate workflow for each audience.`;
  }

  if (lower.includes("billable rate")) {
    return `${title} sits at ${formattedValue}. That makes it a value-capture KPI, because it shows how much delivered output is being converted into commercially meaningful activity.`;
  }

  if (lower.includes("billable")) {
    return `${title} is ${formattedValue}. This number matters because it connects operating throughput to recoverable business value rather than leaving the story at activity alone.`;
  }

  if (lower.includes("recoverable")) {
    return `${formattedValue} remains recoverable in the current slice. This is trapped value that already exists inside the system, which usually makes it faster to unlock than generating net-new volume.`;
  }

  if (lower.includes("stalled")) {
    return `${formattedValue} outputs are currently stalled. This is visible workflow drag: work has already been created, but it has not yet translated into audience or business impact.`;
  }

  if (lower.includes("latency")) {
    return `${title} sits at ${formattedValue}. This is the waiting time between effort and delivery, so it reveals whether the workflow feels responsive or congested.`;
  }

  if (lower.includes("days") || lower.includes("upload") && lower.includes("process") || lower.includes("process") && lower.includes("publish")) {
    return `${title} is ${formattedValue}. That makes it a cycle-time signal, exposing how much queueing and handoff delay the workflow is carrying before value reaches the audience.`;
  }

  if (lower.includes("compression")) {
    return `${title} is ${formattedValue}. This shows how aggressively the system is turning long-form source material into tighter downstream assets without requiring fresh source input.`;
  }

  if (lower.includes("translation uplift")) {
    return `${title} is ${formattedValue}. That reveals whether translated content is merely present in the catalog or actually earning disproportionate value once it is published.`;
  }

  if (lower.includes("translation rate")) {
    return `${title} is ${formattedValue}. This measures how much of the publishing engine is being used to extend reach across languages rather than staying tied to the source language alone.`;
  }

  if (lower.includes("weekend")) {
    return `${title} is ${formattedValue}. This is effectively a scheduling signature, showing whether the operation is distributing content across the full week or clustering releases into narrower windows.`;
  }

  if (lower.includes("reuse")) {
    return `${title} is ${formattedValue}. This is a yield KPI: it shows whether one source asset is being stretched into multiple valuable downstream expressions.`;
  }

  if (lower.includes("repurposing")) {
    return `${title} is ${formattedValue}. This tells you how often the system is extracting the full content opportunity from a source input instead of stopping after the first usable derivative.`;
  }

  if (lower.includes("throughput")) {
    return `${title} is ${formattedValue}. This is a capacity signal, showing how unevenly production output is distributed across the operating network.`;
  }

  if (lower.includes("retention")) {
    return `${title} is ${formattedValue}. That makes it an adoption-quality metric, because it shows whether people return to the workflow instead of touching it once and disappearing.`;
  }

  if (lower.includes("quality") || lower.includes("health") || lower.includes("trust") || lower.includes("completeness")) {
    return `${title} is ${formattedValue}. This is a credibility metric for the rest of the analytics layer, because weak trust signals make every downstream conclusion easier to question.`;
  }

  if (suffixAwareVolume(title, category)) {
    return `${title} is ${formattedValue}. This is not just a count; it is a statement about how much operational surface area the system is supporting right now and how much downstream execution must absorb.`;
  }

  if (category === "coverage") {
    return `${title} is ${formattedValue}. This reads as a footprint metric, showing how broadly the operating model has spread across entities, channels, or destinations.`;
  }

  if (category === "financial") {
    return `${title} is ${formattedValue}. This is one of the clearest indicators that operational performance is translating into measurable business value.`;
  }

  if (category === "speed") {
    return `${title} is ${formattedValue}. This is effectively the workflow's tempo, and tempo is often the clearest signal of operational maturity.`;
  }

  if (category === "risk") {
    return `${title} is ${formattedValue}. This is a leakage signal, showing how much value is being lost or delayed inside the system before it can be realized.`;
  }

  if (category === "rate") {
    return `${title} is ${formattedValue}. Ratio metrics like this are powerful because they reveal execution quality without being distorted by raw scale alone.`;
  }

  return `${title} is ${formattedValue}. ${band.interpretation}`;
}

function suffixAwareVolume(
  title: string,
  category: "speed" | "risk" | "coverage" | "quality" | "rate" | "financial" | "volume",
) {
  return category === "volume" && title.trim().length > 0;
}

function buildStrategicRead(
  title: string,
  description: string | undefined,
  band: { label: string; tone: InsightItem["type"]; interpretation: string },
  category: "speed" | "risk" | "coverage" | "quality" | "rate" | "financial" | "volume",
): string {
  const lower = title.toLowerCase();
  const intro = description ? `${description} ` : "";

  if (lower.includes("uploaded")) {
    return `${intro}At this level, the intake engine looks substantial. The strategic question is whether the rest of the pipeline is preserving that top-of-funnel energy or letting it accumulate as unused inventory.`;
  }

  if (lower.includes("processed")) {
    return `${intro}This is the workflow's productive middle. A number like this is strongest when it stays close to publish output rather than inflating the backlog between creation and delivery.`;
  }

  if (lower.includes("published")) {
    return `${intro}This is delivered throughput, not just effort. When this number holds up, the operating story becomes one of finish quality rather than internal activity.`;
  }

  if (lower.includes("active client") || lower.includes("active user") || lower.includes("active channel")) {
    return `${intro}This KPI is really about breadth of adoption. A strong reading means the platform is becoming embedded across the operating base rather than depending on a narrow cluster of heavy users.`;
  }

  if (lower.includes("recoverable") || lower.includes("stalled")) {
    return `${intro}This KPI points to value already trapped inside the system. It usually signals a cleaner short-term intervention opportunity than trying to create more top-of-funnel volume.`;
  }

  if (category === "volume") {
    return `${intro}This is a scale-bearing KPI. On its own it does not prove effectiveness, but it tells you how much operational mass the rest of the system needs to convert, govern, or distribute.`;
  }

  if (category === "coverage") {
    return `${intro}This reads as a footprint KPI. The stronger it gets, the harder it becomes to dismiss the platform as isolated or narrow in use.`;
  }

  if (category === "financial") {
    return `${intro}This KPI matters because it turns workflow performance into commercial consequence, which is where analytics stops being informative and starts becoming decisive.`;
  }

  if (category === "speed") {
    return `${intro}This is a tempo KPI. At this level, the number describes how much waiting, handoff, or approval friction still exists between creation and delivery.`;
  }

  if (category === "risk") {
    return `${intro}This is a drag KPI. The number represents avoidable loss, so the right move is usually to concentrate on the single biggest leakage pocket first.`;
  }

  return `${intro}At this level, the metric reads as ${band.label.toLowerCase()} rather than a neutral datapoint.`;
}

function describeDelta(
  delta: number | null | undefined,
  deltaLabel: string | undefined,
  lowerIsBetter: boolean,
): { tone: InsightItem["type"]; text: string } {
  if (delta === null || delta === undefined) {
    return {
      tone: "neutral",
      text: "No comparative delta is attached, so this card should be read as a current-state health signal rather than a momentum signal.",
    };
  }

  if (delta === 0) {
    return {
      tone: "neutral",
      text: `The metric is flat ${deltaLabel ?? "vs previous period"}, which means the current operating pattern is stable but not obviously improving.`,
    };
  }

  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return {
    tone: improved ? "positive" : "warning",
    text: improved
      ? `${Math.abs(delta).toFixed(1)}% ${lowerIsBetter ? "lower" : "higher"} ${deltaLabel ?? "than the previous period"}, which suggests the current operating motion is moving in the right direction.`
      : `${Math.abs(delta).toFixed(1)}% ${lowerIsBetter ? "higher" : "lower"} ${deltaLabel ?? "than the previous period"}, which means the number is moving against the desired direction and deserves scrutiny.`,
  };
}

export function buildKpiInsightModel({
  title,
  value,
  suffix,
  description,
  delta,
  deltaLabel,
}: {
  title: string;
  value: number;
  suffix?: string;
  description?: string;
  delta?: number | null;
  deltaLabel?: string;
}): KpiInsightModel {
  const { lowerIsBetter, category } = classifyKpi(title, suffix);
  const formattedValue = formatDisplayValue(value, suffix);
  const band = describeBand(value, suffix, category, lowerIsBetter);
  const metricNarrative = metricSpecificNarrative(title, category, lowerIsBetter);
  const deltaNarrative = describeDelta(delta, deltaLabel, lowerIsBetter);

  const headline = buildKpiHeadline(
    title,
    formattedValue,
    category,
    lowerIsBetter,
    band,
  );
  const sections = [
    {
      label: "Strategic Read",
      text: buildStrategicRead(title, description, band, category),
      tone: band.tone,
    },
    {
      label: "Why It Matters",
      text: metricNarrative.whyItMatters,
      tone: "neutral" as const,
    },
    {
      label: "Momentum",
      text: deltaNarrative.text,
      tone: deltaNarrative.tone,
    },
    {
      label: "Executive Lens",
      text: metricNarrative.executiveLens,
      tone: "neutral" as const,
    },
    {
      label: "Best Next Move",
      text: metricNarrative.actionCue,
      tone: "warning" as const,
    },
  ];

  return {
    headline,
    status: band.label,
    statusTone: band.tone,
    sections,
  };
}

export function extractChartInsightContext(
  children: React.ReactNode,
): InsightContext {
  return extractSeriesContext(children);
}
