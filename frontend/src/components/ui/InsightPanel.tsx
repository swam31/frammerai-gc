"use client";

import React from "react";
import { Lightbulb } from "lucide-react";

export type InsightItem = {
  label?: string;
  text: string;
  type: "positive" | "warning" | "neutral" | "critical";
};

const INSIGHT_DOT: Record<InsightItem["type"], string> = {
  positive: "#22c55e",
  warning: "#f59e0b",
  neutral: "#3b82f6",
  critical: "#ef4444",
};

export default function InsightPanel({
  insights,
  title = "Derived Insights",
}: {
  insights: InsightItem[];
  title?: string;
}) {
  if (insights.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px 20px",
        padding: "14px 18px",
        background: "var(--bg-surface-raised)",
        borderRadius: "var(--radius-md)",
        borderLeft: "3px solid var(--accent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexBasis: "100%",
          marginBottom: 2,
        }}
      >
        <Lightbulb size={13} style={{ color: "var(--accent)" }} />
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
      </div>
      {insights.map((insight, index) => (
        <div
          key={`${insight.label ?? "insight"}-${index}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            flex: "1 1 240px",
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: INSIGHT_DOT[insight.type],
              marginTop: 5,
              flexShrink: 0,
            }}
          />
          <span>
            {insight.label ? (
              <strong style={{ color: "var(--text-primary)" }}>
                {insight.label}:{" "}
              </strong>
            ) : null}
            {insight.text}
          </span>
        </div>
      ))}
    </div>
  );
}
