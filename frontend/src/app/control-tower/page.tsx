"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
} from "recharts";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CircleDollarSign,
  Gauge,
  Lightbulb,
  Orbit,
  Radar as RadarIcon,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import ChartCard from "@/components/ui/ChartCard";
import KpiCard from "@/components/ui/KpiCard";
import { useFilters } from "@/lib/filters-context";
import {
  ActionCardItem,
  ControlTowerResponse,
  HealthScoreItem,
  LostValueResponse,
  OpportunityItem,
  PeerDNAResponse,
  PeerNode,
  ScenarioSimulationRequest,
  ScenarioSimulationResponse,
  buildAnalyticsRequest,
  intelligenceApi,
} from "@/lib/api";
import {
  CHART_COLORS,
  customTooltipStyle,
  formatNumber,
} from "@/lib/chart-utils";

/* ── Types ───────────────────────────────────────────── */

type ScenarioInputs = Pick<
  ScenarioSimulationRequest,
  | "publish_rate_uplift_pct"
  | "process_to_publish_days_improvement"
  | "active_users_uplift_pct"
  | "billable_rate_uplift_pct"
>;

type InsightItem = {
  text: string;
  type: "positive" | "warning" | "neutral" | "critical";
};

/* ── Constants ───────────────────────────────────────── */

const CLUSTER_COLORS: Record<string, string> = {
  "High-conversion syndicators": "#22c55e",
  "Volume without finish": "#ef4444",
  "Multilingual specialists": "#3b82f6",
  "Emerging workspaces": "#f59e0b",
};

const CLUSTER_BG: Record<string, string> = {
  "High-conversion syndicators": "rgba(34,197,94,0.07)",
  "Volume without finish": "rgba(239,68,68,0.07)",
  "Multilingual specialists": "rgba(59,130,246,0.07)",
  "Emerging workspaces": "rgba(245,158,11,0.07)",
};

const DIMENSION_COLORS: Record<string, string> = {
  Adoption: "#3b82f6",
  Conversion: "#22c55e",
  Velocity: "#8b5cf6",
  Coverage: "#f59e0b",
  Quality: "#ec4899",
};

/* ── Helpers ─────────────────────────────────────────── */

function severityBadge(severity: string) {
  if (severity === "high") return "badge-danger";
  if (severity === "medium") return "badge-warning";
  return "badge-info";
}

function healthColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

/* ── SVG path helpers ────────────────────────────────── */

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  if (Math.abs(endAngle - startAngle) < 0.02) return "";
  const clampedEnd = Math.min(endAngle, startAngle + 2 * Math.PI - 0.01);
  const sx = cx + r * Math.cos(startAngle);
  const sy = cy + r * Math.sin(startAngle);
  const ex = cx + r * Math.cos(clampedEnd);
  const ey = cy + r * Math.sin(clampedEnd);
  const large = clampedEnd - startAngle > Math.PI ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
}

function curvedEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  curvature = 0.15,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  return `M ${x1} ${y1} Q ${mx - dy * curvature} ${my + dx * curvature} ${x2} ${y2}`;
}

/* ── Force-directed layout ───────────────────────────── */

interface GraphLayout {
  width: number;
  height: number;
  layout: Map<string, { x: number; y: number; color: string }>;
  clusterZones: {
    cluster: string;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  }[];
}

function forceDirectedLayout(
  nodes: PeerNode[],
  edges: { source: string; target: string; similarity_pct: number }[],
): GraphLayout {
  const W = 1400,
    H = 920;
  const cx = W / 2,
    cy = H / 2;
  const empty: GraphLayout = {
    width: W,
    height: H,
    layout: new Map(),
    clusterZones: [],
  };
  if (nodes.length === 0) return empty;

  const clusterMap = new Map<string, PeerNode[]>();
  nodes.forEach((n) => {
    const arr = clusterMap.get(n.cluster) ?? [];
    arr.push(n);
    clusterMap.set(n.cluster, arr);
  });
  const clusters = Array.from(clusterMap.keys());

  const clusterCenters = new Map<string, { x: number; y: number }>();
  const ringR = Math.min(W, H) * 0.26;
  clusters.forEach((c, i) => {
    if (clusters.length === 1) {
      clusterCenters.set(c, { x: cx, y: cy });
      return;
    }
    if (clusters.length === 2) {
      const offset = W * 0.22;
      clusterCenters.set(c, {
        x: i === 0 ? cx - offset : cx + offset,
        y: cy,
      });
      return;
    }
    const a = (2 * Math.PI * i) / clusters.length - Math.PI / 2;
    clusterCenters.set(c, {
      x: cx + Math.cos(a) * ringR,
      y: cy + Math.sin(a) * ringR,
    });
  });

  type Pos = { x: number; y: number; vx: number; vy: number };
  const pos = new Map<string, Pos>();
  nodes.forEach((node) => {
    const cc = clusterCenters.get(node.cluster)!;
    const siblings = clusterMap.get(node.cluster)!;
    const localIdx = siblings.indexOf(node);
    const localAngle = (2 * Math.PI * localIdx) / siblings.length;
    const spread = 28 + siblings.length * 10;
    pos.set(node.entity_id, {
      x: cc.x + Math.cos(localAngle) * spread,
      y: cc.y + Math.sin(localAngle) * spread,
      vx: 0,
      vy: 0,
    });
  });

  for (let iter = 0; iter < 260; iter++) {
    const decay = 1 - iter / 260;
    const ids = Array.from(pos.keys());

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!,
          b = pos.get(ids[j])!;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 65) dist = 65;
        const f = (3200 * decay) / (dist * dist);
        const fx = (dx / dist) * f,
          fy = (dy / dist) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const edge of edges) {
      const a = pos.get(edge.source),
        b = pos.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const strength = (edge.similarity_pct / 100) * 0.014 * decay;
      const f = (dist - 95) * strength;
      const fx = (dx / dist) * f,
        fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      const p = pos.get(node.entity_id)!;
      const cc = clusterCenters.get(node.cluster)!;
      p.vx += (cc.x - p.x) * 0.013 * decay;
      p.vy += (cc.y - p.y) * 0.013 * decay;
    }

    for (const [, p] of pos) {
      p.vx += (cx - p.x) * 0.0007;
      p.vy += (cy - p.y) * 0.0007;
      p.vx *= 0.82;
      p.vy *= 0.82;
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(60, Math.min(W - 60, p.x));
      p.y = Math.max(60, Math.min(H - 60, p.y));
    }
  }

  const bounds = Array.from(pos.values()).reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    },
  );

  const padX = 120;
  const padY = 96;
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((W - padX * 2) / spanX, (H - padY * 2) / spanY);
  const offsetX =
    (W - spanX * scale) / 2 - bounds.minX * scale;
  const offsetY =
    (H - spanY * scale) / 2 - bounds.minY * scale;

  for (const [, p] of pos) {
    p.x = p.x * scale + offsetX;
    p.y = p.y * scale + offsetY;
  }

  const layout = new Map<string, { x: number; y: number; color: string }>();
  nodes.forEach((n) => {
    const p = pos.get(n.entity_id)!;
    layout.set(n.entity_id, {
      x: p.x,
      y: p.y,
      color: CLUSTER_COLORS[n.cluster] ?? "#dc2626",
    });
  });

  const clusterZones = clusters.map((cluster) => {
    const cNodes = clusterMap.get(cluster)!;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    cNodes.forEach((n) => {
      const p = pos.get(n.entity_id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const pad = 52;
    return {
      cluster,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: Math.max((maxX - minX) / 2 + pad, 58),
      ry: Math.max((maxY - minY) / 2 + pad, 48),
    };
  });

  return { width: W, height: H, layout, clusterZones };
}

/* ── InsightStrip ────────────────────────────────────── */

const INSIGHT_DOT: Record<InsightItem["type"], string> = {
  positive: "#22c55e",
  warning: "#f59e0b",
  neutral: "#3b82f6",
  critical: "#ef4444",
};

function InsightStrip({ insights }: { insights: InsightItem[] }) {
  if (insights.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px 24px",
        padding: "14px 18px",
        background: "var(--bg-surface-raised)",
        borderRadius: "var(--radius-md)",
        marginTop: 12,
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
          Derived Insights
        </span>
      </div>
      {insights.map((insight, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            flex: "1 1 280px",
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
          <span>{insight.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ── PeerGraph (force-directed) ──────────────────────── */

function PeerGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
}: {
  nodes: PeerNode[];
  edges: { source: string; target: string; similarity_pct: number }[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const { width, height, layout, clusterZones } = useMemo(
    () => forceDirectedLayout(nodes, edges),
    [nodes, edges],
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const svgRef = React.useRef<SVGSVGElement>(null);

  const selectedEdgeIds = useMemo(() => {
    const s = new Set<string>();
    edges
      .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
      .forEach((e) => {
        s.add(e.source);
        s.add(e.target);
      });
    return s;
  }, [edges, selectedNodeId]);

  const hoveredNode = hoveredId
    ? nodes.find((n) => n.entity_id === hoveredId)
    : null;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!svgRef.current || !hoveredId) return;
      const rect = svgRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left + 14,
        y: e.clientY - rect.top - 8,
      });
    },
    [hoveredId],
  );

  if (nodes.length === 0) return null;

  return (
    <div
      style={{
        position: "relative",
        minHeight: height,
        height: "100%",
        flex: "1 1 auto",
        display: "flex",
      }}
      onMouseMove={handleMouseMove}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          flex: "1 1 auto",
        }}
      >
        <defs>
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {Object.entries(CLUSTER_COLORS).map(([cluster, color]) => (
            <radialGradient
              key={cluster}
              id={`grad-${cluster.replace(/\s+/g, "-")}`}
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.95" />
              <stop offset="100%" stopColor={color} stopOpacity="0.55" />
            </radialGradient>
          ))}
        </defs>

        {clusterZones.map((zone) => (
          <g key={zone.cluster}>
            <ellipse
              cx={zone.cx}
              cy={zone.cy}
              rx={zone.rx}
              ry={zone.ry}
              fill={CLUSTER_BG[zone.cluster] ?? "rgba(100,100,100,0.05)"}
              stroke={CLUSTER_COLORS[zone.cluster] ?? "#666"}
              strokeOpacity={0.18}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={zone.cx}
              y={zone.cy - zone.ry - 8}
              textAnchor="middle"
              fill={CLUSTER_COLORS[zone.cluster] ?? "#666"}
              fontSize="11"
              fontWeight="700"
              opacity={0.8}
            >
              {zone.cluster}
            </text>
          </g>
        ))}

        {edges.map((edge) => {
          const src = layout.get(edge.source),
            tgt = layout.get(edge.target);
          if (!src || !tgt) return null;
          const isActive =
            edge.source === selectedNodeId || edge.target === selectedNodeId;
          const isHov = edge.source === hoveredId || edge.target === hoveredId;
          return (
            <path
              key={`${edge.source}-${edge.target}`}
              d={curvedEdgePath(src.x, src.y, tgt.x, tgt.y)}
              fill="none"
              stroke={
                isActive
                  ? "var(--accent)"
                  : isHov
                    ? "#a78bfa"
                    : "var(--border-default)"
              }
              strokeOpacity={isActive ? 0.85 : isHov ? 0.6 : 0.28}
              strokeWidth={
                isActive
                  ? Math.max(2.5, edge.similarity_pct / 22)
                  : Math.max(1.2, edge.similarity_pct / 40)
              }
              style={{ transition: "all 0.3s ease" }}
            />
          );
        })}

        {nodes.map((node) => {
          const p = layout.get(node.entity_id);
          if (!p) return null;
          const isSelected = node.entity_id === selectedNodeId;
          const isRelated = selectedNodeId
            ? selectedEdgeIds.has(node.entity_id)
            : false;
          const isHov = node.entity_id === hoveredId;
          const baseR = 20 + Math.min(node.outputs, 35) * 0.45;
          const opacity =
            isSelected || isRelated || isHov || !selectedNodeId ? 1 : 0.35;
          const healthAngle =
            -Math.PI / 2 + (node.health_score / 100) * 2 * Math.PI;
          const gradId = `grad-${node.cluster.replace(/\s+/g, "-")}`;

          return (
            <g
              key={node.entity_id}
              onClick={() => onSelect(node.entity_id)}
              onMouseEnter={() => setHoveredId(node.entity_id)}
              onMouseLeave={() => {
                setHoveredId(null);
                setTooltipPos(null);
              }}
              style={{ cursor: "pointer", transition: "opacity 0.3s" }}
              opacity={opacity}
            >
              {isSelected && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={baseR + 8}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={2}
                >
                  <animate
                    attributeName="r"
                    values={`${baseR + 6};${baseR + 15};${baseR + 6}`}
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.6;0.12;0.6"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              <circle
                cx={p.x}
                cy={p.y}
                r={baseR + 3.5}
                fill="none"
                stroke="var(--border-default)"
                strokeWidth={3}
                strokeOpacity={0.2}
              />

              {node.health_score > 0 && (
                <path
                  d={describeArc(
                    p.x,
                    p.y,
                    baseR + 3.5,
                    -Math.PI / 2,
                    healthAngle,
                  )}
                  fill="none"
                  stroke={healthColor(node.health_score)}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              )}

              <circle
                cx={p.x}
                cy={p.y}
                r={baseR}
                fill={`url(#${gradId})`}
                stroke={
                  isSelected ? "#fff" : isHov ? "#fff" : "rgba(255,255,255,0.2)"
                }
                strokeWidth={isSelected ? 2.5 : isHov ? 2 : 1}
                filter={isSelected || isHov ? "url(#node-glow)" : undefined}
              />

              <text
                x={p.x}
                y={p.y + 1}
                fill="#fff"
                fontSize="12"
                fontWeight="800"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  pointerEvents: "none",
                  textShadow: "0 1px 3px rgba(0,0,0,0.45)",
                }}
              >
                {node.publish_rate_pct.toFixed(0)}%
              </text>

              <text
                x={p.x}
                y={p.y + baseR + 16}
                fill="var(--text-primary)"
                fontSize="10.5"
                fontWeight="600"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {node.entity_name.length > 18
                  ? `${node.entity_name.slice(0, 18)}…`
                  : node.entity_name}
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredNode && tooltipPos && (
        <div
          style={{
            position: "absolute",
            left: Math.min(
              tooltipPos.x,
              (svgRef.current?.clientWidth ?? width) - 240,
            ),
            top: tooltipPos.y,
            transform: "translateY(-100%)",
            background: "var(--bg-surface-solid)",
            border: "1px solid var(--border-default)",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "var(--shadow-lg)",
            fontSize: "0.8rem",
            pointerEvents: "none",
            zIndex: 20,
            minWidth: 210,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {hoveredNode.entity_name}
          </div>
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              marginBottom: 10,
            }}
          >
            {hoveredNode.client_name} · {hoveredNode.cluster}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "5px 16px",
              fontSize: "0.78rem",
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>Health</span>
            <span
              style={{
                fontWeight: 600,
                color: healthColor(hoveredNode.health_score),
              }}
            >
              {hoveredNode.health_score}
            </span>
            <span style={{ color: "var(--text-muted)" }}>Publish Rate</span>
            <span style={{ fontWeight: 600 }}>
              {hoveredNode.publish_rate_pct}%
            </span>
            <span style={{ color: "var(--text-muted)" }}>Outputs</span>
            <span style={{ fontWeight: 600 }}>
              {formatNumber(hoveredNode.outputs)}
            </span>
            <span style={{ color: "var(--text-muted)" }}>Lost Hours</span>
            <span
              style={{
                fontWeight: 600,
                color: hoveredNode.lost_hours > 10 ? "#ef4444" : "inherit",
              }}
            >
              {hoveredNode.lost_hours}
            </span>
            <span style={{ color: "var(--text-muted)" }}>Velocity</span>
            <span style={{ fontWeight: 600 }}>
              {hoveredNode.avg_process_to_publish_days}d
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────── */

export default function ControlTowerPage() {
  const { dateRange, filters, loading: filtersLoading } = useFilters();
  const [controlTower, setControlTower] = useState<ControlTowerResponse | null>(
    null,
  );
  const [lostValue, setLostValue] = useState<LostValueResponse | null>(null);
  const [peerDna, setPeerDna] = useState<PeerDNAResponse | null>(null);
  const [simulation, setSimulation] =
    useState<ScenarioSimulationResponse | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simLoading, setSimLoading] = useState(false);
  const [scenarioInputs, setScenarioInputs] = useState<ScenarioInputs>({
    publish_rate_uplift_pct: 12,
    process_to_publish_days_improvement: 1.5,
    active_users_uplift_pct: 8,
    billable_rate_uplift_pct: 4,
  });

  const loadEverything = useCallback(async () => {
    if (filtersLoading) return;
    setLoading(true);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const [controlRes, lostRes, peerRes] = await Promise.all([
        intelligenceApi.controlTower(req).catch(() => null),
        intelligenceApi.lostValue(req).catch(() => null),
        intelligenceApi.peerDna(req).catch(() => null),
      ]);
      setControlTower(controlRes as ControlTowerResponse | null);
      setLostValue(lostRes as LostValueResponse | null);
      setPeerDna(peerRes as PeerDNAResponse | null);
      const peerNodes = (peerRes as PeerDNAResponse | null)?.nodes ?? [];
      setSelectedPeerId(peerNodes[0]?.entity_id ?? null);
    } finally {
      setLoading(false);
    }
  }, [dateRange, filters, filtersLoading]);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  const runSimulation = useCallback(async () => {
    if (filtersLoading) return;
    setSimLoading(true);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const scenarioReq: ScenarioSimulationRequest = {
        ...req,
        ...scenarioInputs,
      };
      const scenarioRes = await intelligenceApi.scenarioSimulator(scenarioReq);
      setSimulation(scenarioRes);
    } finally {
      setSimLoading(false);
    }
  }, [dateRange, filters, filtersLoading, scenarioInputs]);

  useEffect(() => {
    runSimulation();
  }, [runSimulation]);

  /* ── Derived data ────────────────────────────────────── */

  const healthRows = useMemo(
    () =>
      [...(controlTower?.health_scores ?? [])]
        .sort((a, b) => b.health_score - a.health_score)
        .slice(0, 8),
    [controlTower],
  );
  const weakestRows = useMemo(
    () =>
      [...(controlTower?.health_scores ?? [])]
        .sort((a, b) => a.health_score - b.health_score)
        .slice(0, 5),
    [controlTower],
  );
  const selectedPeer = useMemo(
    () =>
      peerDna?.nodes.find((node) => node.entity_id === selectedPeerId) ?? null,
    [peerDna, selectedPeerId],
  );
  const selectedPlaybook = useMemo(
    () =>
      peerDna?.playbooks.find((item) => item.entity_id === selectedPeerId) ??
      peerDna?.playbooks[0] ??
      null,
    [peerDna, selectedPeerId],
  );

  const healthLookup = useMemo(() => {
    const map = new Map<string, HealthScoreItem>();
    (controlTower?.health_scores ?? []).forEach((item) =>
      map.set(String(item.entity_id), item),
    );
    return map;
  }, [controlTower]);

  const healthBarData = useMemo(
    () =>
      healthRows.map((row) => ({
        entity_name: row.entity_name,
        Adoption: Math.round(row.adoption_score * 0.3 * 10) / 10,
        Conversion: Math.round(row.conversion_score * 0.25 * 10) / 10,
        Velocity: Math.round(row.velocity_score * 0.2 * 10) / 10,
        Coverage: Math.round(row.coverage_score * 0.15 * 10) / 10,
        Quality: Math.round(row.data_quality_score * 0.1 * 10) / 10,
      })),
    [healthRows],
  );

  const radarData = useMemo(() => {
    if (!selectedPeerId || !selectedPlaybook) return [];
    const sel = healthLookup.get(String(selectedPeerId));
    const peer = healthLookup.get(String(selectedPlaybook.peer_id));
    if (!sel) return [];
    return [
      {
        dim: "Adoption",
        selected: sel.adoption_score,
        benchmark: peer?.adoption_score ?? 0,
      },
      {
        dim: "Conversion",
        selected: sel.conversion_score,
        benchmark: peer?.conversion_score ?? 0,
      },
      {
        dim: "Velocity",
        selected: sel.velocity_score,
        benchmark: peer?.velocity_score ?? 0,
      },
      {
        dim: "Coverage",
        selected: sel.coverage_score,
        benchmark: peer?.coverage_score ?? 0,
      },
      {
        dim: "Quality",
        selected: sel.data_quality_score,
        benchmark: peer?.data_quality_score ?? 0,
      },
    ];
  }, [selectedPeerId, selectedPlaybook, healthLookup]);

  /* ── Network metrics ─────────────────────────────────── */

  const networkMetrics = useMemo(() => {
    const n = peerDna?.nodes ?? [];
    const e = peerDna?.edges ?? [];
    const maxEdges = (n.length * (n.length - 1)) / 2;
    const density = maxEdges > 0 ? (e.length / maxEdges) * 100 : 0;
    const avgSim =
      e.length > 0
        ? e.reduce((s, ed) => s + ed.similarity_pct, 0) / e.length
        : 0;
    let intra = 0,
      inter = 0;
    e.forEach((ed) => {
      const src = n.find((x) => x.entity_id === ed.source);
      const tgt = n.find((x) => x.entity_id === ed.target);
      if (src && tgt) {
        if (src.cluster === tgt.cluster) intra++;
        else inter++;
      }
    });
    return {
      density: Math.round(density),
      avgSimilarity: Math.round(avgSim),
      clusters: peerDna?.clusters.length ?? 0,
      bridges: inter,
      intraEdges: intra,
    };
  }, [peerDna]);

  /* ── Insight derivation ──────────────────────────────── */

  const healthInsights = useMemo((): InsightItem[] => {
    const scores = controlTower?.health_scores ?? [];
    if (scores.length < 2) return [];
    const sorted = [...scores].sort((a, b) => b.health_score - a.health_score);
    const top = sorted[0],
      bottom = sorted[sorted.length - 1];
    const avg = scores.reduce((s, r) => s + r.health_score, 0) / scores.length;
    const dangerZone = scores.filter((s) => s.health_score < 50).length;
    const weakestDim = (
      [
        "adoption_score",
        "conversion_score",
        "velocity_score",
        "coverage_score",
        "data_quality_score",
      ] as const
    )
      .map((k) => ({
        dim: k.replace("_score", ""),
        avg: scores.reduce((s, r) => s + r[k], 0) / scores.length,
      }))
      .sort((a, b) => a.avg - b.avg)[0];
    const items: InsightItem[] = [
      {
        text: `${top.entity_name} leads at ${top.health_score} - a ${(top.health_score - bottom.health_score).toFixed(0)}pt spread to the weakest channel.`,
        type: "neutral",
      },
    ];
    if (dangerZone > 0)
      items.push({
        text: `${dangerZone} channel${dangerZone > 1 ? "s" : ""} below the critical 50-point threshold - immediate operational review warranted.`,
        type: "critical",
      });
    items.push({
      text: `Fleet average is ${avg.toFixed(1)} - weakest dimension across the board is ${weakestDim.dim} (avg ${weakestDim.avg.toFixed(0)}).`,
      type: avg >= 55 ? "neutral" : "warning",
    });
    return items;
  }, [controlTower]);

  const driverInsights = useMemo((): InsightItem[] => {
    const drivers = controlTower?.drivers ?? [];
    if (drivers.length === 0) return [];
    const totalGap = drivers.reduce((s, d) => s + d.gap_hours, 0);
    const top2Share = drivers
      .slice(0, 2)
      .reduce((s, d) => s + d.share_of_gap_pct, 0);
    const dimCounts: Record<string, number> = {};
    drivers.forEach((d) => {
      dimCounts[d.dimension] = (dimCounts[d.dimension] ?? 0) + 1;
    });
    const dominantDim = Object.entries(dimCounts).sort(
      (a, b) => b[1] - a[1],
    )[0];
    return [
      {
        text: `Top 2 root causes alone drive ${top2Share.toFixed(0)}% of the publish gap - fixing these first maximizes ROI.`,
        type: top2Share > 60 ? "critical" : "warning",
      },
      {
        text: `Total gap across all drivers: ${totalGap.toFixed(1)} hours of recoverable output at stake.`,
        type: "neutral",
      },
      {
        text: `The "${dominantDim[0].replace("_", " ")}" dimension appears ${dominantDim[1]}x - systemic pattern worth investigating.`,
        type: "warning",
      },
    ];
  }, [controlTower]);

  const actionInsights = useMemo((): InsightItem[] => {
    const actions = controlTower?.action_cards ?? [];
    if (actions.length === 0) return [];
    const highSev = actions.filter((a) => a.severity === "high").length;
    const totalVal = actions.reduce(
      (s, a) => s + (typeof a.value === "number" ? a.value : 0),
      0,
    );
    return [
      {
        text: `${highSev} of ${actions.length} actions flagged as high severity - prioritize these in the next sprint.`,
        type: highSev > 2 ? "critical" : "warning",
      },
      {
        text: `Combined recoverable value across the queue: ${totalVal.toFixed(1)} hours waiting to be unlocked.`,
        type: "neutral",
      },
    ];
  }, [controlTower]);

  const opportunityInsights = useMemo((): InsightItem[] => {
    const opps = controlTower?.opportunities ?? [];
    if (opps.length < 3) return [];
    const top3Hours = opps
      .slice(0, 3)
      .reduce((s, o) => s + o.recoverable_published_hours, 0);
    const totalHours = opps.reduce(
      (s, o) => s + o.recoverable_published_hours,
      0,
    );
    const top3Share = totalHours > 0 ? (top3Hours / totalHours) * 100 : 0;
    const issueMap: Record<string, number> = {};
    opps.forEach((o) => {
      issueMap[o.primary_issue] = (issueMap[o.primary_issue] ?? 0) + 1;
    });
    const topIssue = Object.entries(issueMap).sort((a, b) => b[1] - a[1])[0];
    return [
      {
        text: `Top 3 workspaces represent ${top3Share.toFixed(0)}% of all recoverable hours - high concentration means high-leverage interventions.`,
        type: top3Share > 60 ? "positive" : "neutral",
      },
      {
        text: `Most common issue: "${topIssue[0]}" (${topIssue[1]} workspace${topIssue[1] > 1 ? "s" : ""}) - a systemic fix scales faster than individual treatment.`,
        type: "warning",
      },
    ];
  }, [controlTower]);

  const simulatorInsights = useMemo((): InsightItem[] => {
    if (!simulation) return [];
    const proj = simulation.projection;
    const base = simulation.baseline;
    const gap = Math.max(base.output_hours - base.published_hours, 0.01);
    const recoveryPct =
      proj.net_new_published_hours > 0
        ? (proj.net_new_published_hours / gap) * 100
        : 0;
    const items: InsightItem[] = [];
    if (proj.net_new_published_hours > 0) {
      items.push({
        text: `This scenario recovers ${proj.net_new_published_hours.toFixed(1)} hours - ${recoveryPct.toFixed(0)}% of the current gap closed.`,
        type: recoveryPct > 40 ? "positive" : "neutral",
      });
    }
    if (proj.projected_billable_hours > 0) {
      const currentBillable =
        (base.published_hours * base.billable_rate_pct) / 100;
      const mult =
        currentBillable > 0
          ? proj.projected_billable_hours / currentBillable
          : 0;
      items.push({
        text: `Billable output would reach ${proj.projected_billable_hours.toFixed(0)} hrs - ${mult.toFixed(1)}x over current billable base.`,
        type: mult > 1.3 ? "positive" : "neutral",
      });
    }
    return items;
  }, [simulation]);

  const lostValueInsights = useMemo((): InsightItem[] => {
    if (!lostValue) return [];
    const s = lostValue.summary;
    const conversionLoss =
      s.processed_outputs > 0
        ? (s.stalled_outputs / s.processed_outputs) * 100
        : 0;
    const items: InsightItem[] = [
      {
        text: `${conversionLoss.toFixed(0)}% of processed output never reaches publication - ${s.stalled_outputs.toLocaleString()} outputs stalled in pipeline.`,
        type: conversionLoss > 40 ? "critical" : "warning",
      },
      {
        text: `${s.recoverable_hours.toFixed(1)} hours recoverable, of which ${s.recoverable_billable_hours.toFixed(1)} are billable - direct revenue trapped.`,
        type: "neutral",
      },
    ];
    if (s.avg_process_to_publish_days > 3) {
      items.push({
        text: `Avg latency ${s.avg_process_to_publish_days.toFixed(1)} days - reducing this is the fastest lever to unlock stalled inventory.`,
        type: "warning",
      });
    }
    return items;
  }, [lostValue]);

  const waterfallInsights = useMemo((): InsightItem[] => {
    const wf = lostValue?.waterfall ?? [];
    if (wf.length < 3) return [];
    const processed = wf[0]?.value ?? 0;
    const published = wf[1]?.value ?? 0;
    const dropPct =
      processed > 0 ? ((processed - published) / processed) * 100 : 0;
    return [
      {
        text: `${dropPct.toFixed(0)}% drop from processed to published - the single largest value destruction point in the pipeline.`,
        type: dropPct > 30 ? "critical" : "warning",
      },
    ];
  }, [lostValue]);

  const clientLeakageInsights = useMemo((): InsightItem[] => {
    const clients = lostValue?.by_client ?? [];
    if (clients.length < 2) return [];
    const total = clients.reduce((s, c) => s + c.gap_hours, 0);
    const topShare = total > 0 ? (clients[0].gap_hours / total) * 100 : 0;
    return [
      {
        text: `"${clients[0].dimension_label}" drives ${topShare.toFixed(0)}% of all client leakage (${clients[0].gap_hours.toFixed(1)} hrs) - a targeted engagement could shift the entire metric.`,
        type: topShare > 40 ? "critical" : "warning",
      },
    ];
  }, [lostValue]);

  const formatLeakageInsights = useMemo((): InsightItem[] => {
    const formats = lostValue?.by_output_type ?? [];
    if (formats.length < 1) return [];
    return [
      {
        text: `"${formats[0].dimension_label}" is the leakiest format at ${formats[0].gap_hours.toFixed(1)} gap hours - review the publishing workflow for this output type.`,
        type: "warning",
      },
    ];
  }, [lostValue]);

  const peerDnaInsights = useMemo((): InsightItem[] => {
    if (!peerDna || peerDna.nodes.length === 0) return [];
    const items: InsightItem[] = [];

    const clusterHealth = new Map<string, { avg: number; lostHrs: number }>();
    for (const cl of peerDna.clusters) {
      const cNodes = peerDna.nodes.filter((n) => n.cluster === cl.cluster);
      const avgH =
        cNodes.reduce((s, n) => s + n.health_score, 0) / cNodes.length;
      const lostH = cNodes.reduce((s, n) => s + n.lost_hours, 0);
      clusterHealth.set(cl.cluster, { avg: avgH, lostHrs: lostH });
    }
    const sorted = [...clusterHealth.entries()].sort(
      (a, b) => b[1].avg - a[1].avg,
    );
    if (sorted.length >= 2) {
      const gap = sorted[0][1].avg - sorted[sorted.length - 1][1].avg;
      items.push({
        text: `"${sorted[0][0]}" leads with avg health ${sorted[0][1].avg.toFixed(0)} - ${gap.toFixed(0)}pt ahead of "${sorted[sorted.length - 1][0]}".`,
        type: "neutral",
      });
    }

    const worst = sorted[sorted.length - 1];
    if (worst && worst[1].lostHrs > 0) {
      items.push({
        text: `"${worst[0]}" is bleeding ${worst[1].lostHrs.toFixed(1)} lost hours - playbook interventions from top clusters could recover this.`,
        type: worst[1].lostHrs > 50 ? "critical" : "warning",
      });
    }

    if (networkMetrics.density < 30) {
      items.push({
        text: `Network density is only ${networkMetrics.density}% - most channels operate in behavioral silos with few shared patterns.`,
        type: "warning",
      });
    } else {
      items.push({
        text: `Network density at ${networkMetrics.density}% indicates strong behavioral overlap - channels can realistically adopt each other's playbooks.`,
        type: "positive",
      });
    }

    if (networkMetrics.bridges > 0) {
      items.push({
        text: `${networkMetrics.bridges} cross-cluster bridge${networkMetrics.bridges > 1 ? "s" : ""} detected - these channels share traits across archetypes and can serve as transition models.`,
        type: "positive",
      });
    }

    return items;
  }, [peerDna, networkMetrics]);

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div className="page-container">
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="page-title">Control Tower</h1>
          <p className="page-subtitle" style={{ maxWidth: 780 }}>
            One layer above reporting. This page scores operational health,
            explains where value is leaking, and maps which channels should copy
            whose playbook.
          </p>
        </div>
        <div
          className="card-static"
          style={{ padding: "18px 20px", minWidth: 280 }}
        >
          <div className="label" style={{ marginBottom: 8 }}>
            Intelligence Layer
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="badge badge-info">
              <BrainCircuit size={12} /> Control Tower
            </span>
            <span className="badge badge-warning">
              <CircleDollarSign size={12} /> Lost Value Engine
            </span>
            <span className="badge badge-success">
              <Orbit size={12} /> Peer DNA Graph
            </span>
          </div>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid-4 stagger section-gap">
        <KpiCard
          title="Health Score"
          value={controlTower?.summary.overall_health_score ?? 0}
          suffix="/100"
          description="Weighted score across adoption, conversion, velocity, coverage, and data quality."
          icon={<Gauge size={16} />}
          loading={loading}
        />
        <KpiCard
          title="Recoverable Hours"
          value={controlTower?.summary.recoverable_published_hours ?? 0}
          suffix="hrs"
          description="Processed output that can still be turned into published inventory."
          icon={<Target size={16} />}
          loading={loading}
        />
        <KpiCard
          title="Billable Upside"
          value={controlTower?.summary.recoverable_billable_hours ?? 0}
          suffix="hrs"
          description="Estimated billable opportunity trapped inside the current publish gap."
          icon={<CircleDollarSign size={16} />}
          loading={loading}
        />
        <KpiCard
          title="Avg Publish Rate"
          value={controlTower?.summary.avg_publish_rate_pct ?? 0}
          suffix="%"
          description="Mean processed-to-published conversion across tracked channels."
          icon={<RadarIcon size={16} />}
          loading={loading}
        />
      </div>

      {/* Health Leaderboard + Root-Cause Drivers */}
      <div className="grid-2 section-gap">
        <div>
          <ChartCard
            title="Channel Health Leaderboard"
            description="Stacked decomposition of each channel's health score across 5 operational dimensions."
            autoInsights={false}
            loading={loading}
            minHeight={320}
            isEmpty={healthRows.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={healthBarData}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="entity_name"
                  tick={{ fontSize: 10 }}
                  width={88}
                />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                <Bar
                  dataKey="Adoption"
                  stackId="health"
                  fill={DIMENSION_COLORS.Adoption}
                />
                <Bar
                  dataKey="Conversion"
                  stackId="health"
                  fill={DIMENSION_COLORS.Conversion}
                />
                <Bar
                  dataKey="Velocity"
                  stackId="health"
                  fill={DIMENSION_COLORS.Velocity}
                />
                <Bar
                  dataKey="Coverage"
                  stackId="health"
                  fill={DIMENSION_COLORS.Coverage}
                />
                <Bar
                  dataKey="Quality"
                  stackId="health"
                  fill={DIMENSION_COLORS.Quality}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <InsightStrip insights={healthInsights} />
        </div>

        <div>
          <ChartCard
            title="Root-Cause Drivers"
            description="Dimensions contributing the most gap between processed output and published inventory."
            autoInsights={false}
            loading={loading}
            minHeight={320}
            isEmpty={(controlTower?.drivers.length ?? 0) === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={controlTower?.drivers ?? []}
                margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="dimension_label"
                  tick={{ fontSize: 9 }}
                  angle={-20}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                <Bar
                  dataKey="gap_hours"
                  name="Gap Hours"
                  fill="var(--accent)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="share_of_gap_pct"
                  name="Share %"
                  fill="var(--amber)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <InsightStrip insights={driverInsights} />
        </div>
      </div>

      {/* Action Queue + Opportunities */}
      <div className="grid-2 section-gap">
        <div>
          <ChartCard
            title="Action Queue"
            description="Templated actions that convert the analytics into an operations plan."
            autoInsights={false}
            loading={loading}
            minHeight={340}
            isEmpty={(controlTower?.action_cards.length ?? 0) === 0}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(controlTower?.action_cards ?? []).map(
                (action: ActionCardItem, index) => (
                  <div
                    key={`${action.title}-${index}`}
                    className="card-flush"
                    style={{ padding: "16px 18px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{action.title}</div>
                      <span
                        className={`badge ${severityBadge(action.severity)}`}
                      >
                        {action.severity}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.84rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.55,
                      }}
                    >
                      {action.detail}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 10,
                        fontSize: "0.76rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      <span>{action.owner}</span>
                      <span>
                        {action.metric}: {action.value}
                      </span>
                    </div>
                  </div>
                ),
              )}
            </div>
          </ChartCard>
          <InsightStrip insights={actionInsights} />
        </div>

        <div>
          <ChartCard
            title="Highest-Upside Workspaces"
            description="Where to intervene first to unlock published and billable capacity."
            autoInsights={false}
            loading={loading}
            minHeight={340}
            isEmpty={(controlTower?.opportunities.length ?? 0) === 0}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(controlTower?.opportunities ?? [])
                .slice(0, 5)
                .map((item: OpportunityItem) => (
                  <div
                    key={item.entity_id}
                    className="card-flush"
                    style={{ padding: "16px 18px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {item.entity_name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.76rem",
                            color: "var(--text-muted)",
                            marginTop: 4,
                          }}
                        >
                          {item.client_name}
                        </div>
                      </div>
                      <span className="badge badge-warning">
                        {item.likely_impact_score.toFixed(0)} impact
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        marginTop: 12,
                        fontSize: "0.8rem",
                      }}
                    >
                      <span>
                        {item.recoverable_published_hours.toFixed(1)} hrs
                        recoverable
                      </span>
                      <span>
                        {item.recoverable_billable_hours.toFixed(1)} hrs
                        billable
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-secondary)",
                        marginTop: 10,
                        lineHeight: 1.55,
                      }}
                    >
                      {item.recommended_action}
                    </p>
                  </div>
                ))}
            </div>
          </ChartCard>
          <InsightStrip insights={opportunityInsights} />
        </div>
      </div>

      {/* Scenario Simulator */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Scenario Simulator</h3>
        </div>
        <div className="grid-2">
          <div className="card-static" style={{ padding: "24px 26px" }}>
            <div className="label" style={{ marginBottom: 18 }}>
              What-if Controls
            </div>
            {[
              ["Publish rate uplift", "publish_rate_uplift_pct", 0, 30, "%"],
              [
                "Days removed from process to publish",
                "process_to_publish_days_improvement",
                0,
                5,
                "days",
              ],
              ["Active user uplift", "active_users_uplift_pct", 0, 25, "%"],
              ["Billable rate uplift", "billable_rate_uplift_pct", 0, 15, "%"],
            ].map(([label, key, min, max, suffix]) => (
              <div key={String(key)} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    fontSize: "0.84rem",
                  }}
                >
                  <span>{label}</span>
                  <span className="mono">
                    {scenarioInputs[key as keyof ScenarioInputs]} {suffix}
                  </span>
                </div>
                <input
                  type="range"
                  min={Number(min)}
                  max={Number(max)}
                  step={key === "process_to_publish_days_improvement" ? 0.5 : 1}
                  value={scenarioInputs[key as keyof ScenarioInputs]}
                  onChange={(event) =>
                    setScenarioInputs((prev) => ({
                      ...prev,
                      [key]: Number(event.target.value),
                    }))
                  }
                  style={{ width: "100%" }}
                />
              </div>
            ))}
            <button
              className="btn-primary"
              onClick={runSimulation}
              disabled={simLoading}
            >
              <Bot size={16} />{" "}
              {simLoading ? "Running model..." : "Run simulation"}
            </button>
          </div>

          <div className="card-static" style={{ padding: "24px 26px" }}>
            <div className="label" style={{ marginBottom: 16 }}>
              Projected Lift
            </div>
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="card-flush" style={{ padding: "18px 16px" }}>
                <div className="label">Net New Outputs</div>
                <div className="kpi-number-sm" style={{ marginTop: 10 }}>
                  {simulation?.projection.net_new_published_outputs ?? 0}
                </div>
              </div>
              <div className="card-flush" style={{ padding: "18px 16px" }}>
                <div className="label">Net New Hours</div>
                <div className="kpi-number-sm" style={{ marginTop: 10 }}>
                  {simulation?.projection.net_new_published_hours ?? 0}
                </div>
              </div>
              <div className="card-flush" style={{ padding: "18px 16px" }}>
                <div className="label">Projected Billable Hours</div>
                <div className="kpi-number-sm" style={{ marginTop: 10 }}>
                  {simulation?.projection.projected_billable_hours ?? 0}
                </div>
              </div>
              <div className="card-flush" style={{ padding: "18px 16px" }}>
                <div className="label">Projected Velocity</div>
                <div className="kpi-number-sm" style={{ marginTop: 10 }}>
                  {simulation?.projection.projected_process_to_publish_days ??
                    0}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 20 }}>
              <div className="label" style={{ marginBottom: 10 }}>
                Assumptions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(simulation?.assumptions ?? []).map((line) => (
                  <div
                    key={line}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: "0.82rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Sparkles
                      size={13}
                      style={{ marginTop: 2, color: "var(--accent)" }}
                    />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
            <InsightStrip insights={simulatorInsights} />
          </div>
        </div>
      </div>

      {/* Lost Value Engine */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Lost Value Engine</h3>
        </div>
        <div className="grid-3" style={{ marginBottom: 20 }}>
          <KpiCard
            title="Stalled Outputs"
            value={lostValue?.summary.stalled_outputs ?? 0}
            description="Processed inventory waiting to become published content."
            icon={<AlertTriangle size={16} />}
            loading={loading}
          />
          <KpiCard
            title="Recoverable Hours"
            value={lostValue?.summary.recoverable_hours ?? 0}
            suffix="hrs"
            description="Hours trapped between processing and publishing."
            icon={<CircleDollarSign size={16} />}
            loading={loading}
          />
          <KpiCard
            title="Avg Publish Latency"
            value={lostValue?.summary.avg_process_to_publish_days ?? 0}
            suffix="days"
            description="The average time processed output spends before getting published."
            icon={<Gauge size={16} />}
            loading={loading}
          />
        </div>
        <InsightStrip insights={lostValueInsights} />
        <div className="grid-3" style={{ marginTop: 16 }}>
          <div>
            <ChartCard
              title="Value Waterfall"
              description="From processed output to published inventory to recoverable upside."
              autoInsights={false}
              loading={loading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={lostValue?.waterfall ?? []}
                  margin={{ top: 8, right: 12, left: -8, bottom: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="stage"
                    tick={{ fontSize: 9 }}
                    angle={-15}
                    textAnchor="end"
                    height={54}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {(lostValue?.waterfall ?? []).map((item, index) => (
                      <Cell
                        key={item.stage}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <InsightStrip insights={waterfallInsights} />
          </div>
          <div>
            <ChartCard
              title="Client Leakage"
              description="Clients with the biggest recoverable published hours."
              autoInsights={false}
              loading={loading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={lostValue?.by_client ?? []}
                  layout="vertical"
                  margin={{ top: 0, right: 12, left: 12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="dimension_label"
                    tick={{ fontSize: 9 }}
                    width={86}
                  />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Bar
                    dataKey="gap_hours"
                    fill="var(--accent)"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <InsightStrip insights={clientLeakageInsights} />
          </div>
          <div>
            <ChartCard
              title="Format Leakage"
              description="Output formats where processed hours are getting stuck."
              autoInsights={false}
              loading={loading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={lostValue?.by_output_type ?? []}
                  margin={{ top: 8, right: 12, left: -8, bottom: 36 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="dimension_label"
                    tick={{ fontSize: 9 }}
                    angle={-20}
                    textAnchor="end"
                    height={54}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Bar
                    dataKey="gap_hours"
                    fill="var(--amber)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <InsightStrip insights={formatLeakageInsights} />
          </div>
        </div>
      </div>

      {/* Peer DNA Graph */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Peer DNA Graph</h3>
        </div>

        {/* Network metrics strip */}
        {!loading && peerDna && peerDna.nodes.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 18,
              flexWrap: "wrap",
            }}
          >
            {[
              {
                label: "Network Density",
                value: `${networkMetrics.density}%`,
                icon: <Orbit size={14} />,
                desc: "Ratio of actual behavioral links to possible links",
              },
              {
                label: "Avg Similarity",
                value: `${networkMetrics.avgSimilarity}%`,
                icon: <Zap size={14} />,
                desc: "Mean cosine similarity across all connected pairs",
              },
              {
                label: "Clusters",
                value: String(networkMetrics.clusters),
                icon: <BrainCircuit size={14} />,
                desc: "Distinct behavioral archetypes identified",
              },
              {
                label: "Cross-Cluster Bridges",
                value: String(networkMetrics.bridges),
                icon: <Target size={14} />,
                desc: "Edges connecting different cluster archetypes",
              },
            ].map((m) => (
              <div
                key={m.label}
                className="card-flush"
                style={{
                  flex: "1 1 180px",
                  padding: "14px 16px",
                  textAlign: "center",
                }}
                title={m.desc}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>{m.icon}</span>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {m.label}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "1.3rem",
                    fontWeight: 800,
                    color: "var(--text-primary)",
                  }}
                >
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          <div>
            <ChartCard
              title="Behavioral Similarity Map"
              description="Force-directed graph clustering channels by operational DNA. Node size = output volume. Arc ring = health score. Click a node to inspect its playbook."
              autoInsights={false}
              loading={loading}
              minHeight={920}
              isEmpty={(peerDna?.nodes.length ?? 0) === 0}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: "1 1 auto",
                  minHeight: 0,
                  height: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 14,
                  }}
                >
                  {(peerDna?.clusters ?? []).map((cluster) => (
                    <span key={cluster.cluster} className="badge badge-neutral">
                      <span
                        className="accent-dot"
                        style={{
                          background:
                            CLUSTER_COLORS[cluster.cluster] ?? "var(--accent)",
                        }}
                      />
                      {cluster.cluster} ({cluster.count})
                    </span>
                  ))}
                </div>
                <PeerGraph
                  nodes={peerDna?.nodes ?? []}
                  edges={peerDna?.edges ?? []}
                  selectedNodeId={selectedPeerId}
                  onSelect={setSelectedPeerId}
                />
              </div>
            </ChartCard>
            <InsightStrip insights={peerDnaInsights} />
          </div>

          <ChartCard
            title="Peer Playbook"
            description="The closest higher-performing peer for the selected node, plus the gap it can realistically close."
            autoInsights={false}
            loading={loading}
            minHeight={520}
            isEmpty={!selectedPeer}
          >
            {selectedPeer && (
              <div>
                <div
                  className="card-flush"
                  style={{ padding: "18px 18px", marginBottom: 16 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {selectedPeer.entity_name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.76rem",
                          color: "var(--text-muted)",
                          marginTop: 4,
                        }}
                      >
                        {selectedPeer.client_name}
                      </div>
                    </div>
                    <span className="badge badge-info">
                      {selectedPeer.cluster}
                    </span>
                  </div>
                  <div className="grid-2" style={{ gap: 12, marginTop: 14 }}>
                    <div>
                      <span className="label">Health</span>
                      <div
                        className="kpi-number-sm"
                        style={{
                          color: healthColor(selectedPeer.health_score),
                        }}
                      >
                        {selectedPeer.health_score}
                      </div>
                    </div>
                    <div>
                      <span className="label">Publish Rate</span>
                      <div className="kpi-number-sm">
                        {selectedPeer.publish_rate_pct}%
                      </div>
                    </div>
                    <div>
                      <span className="label">Outputs</span>
                      <div className="kpi-number-sm">
                        {formatNumber(selectedPeer.outputs)}
                      </div>
                    </div>
                    <div>
                      <span className="label">Lost Hours</span>
                      <div
                        className="kpi-number-sm"
                        style={{
                          color:
                            selectedPeer.lost_hours > 10
                              ? "#ef4444"
                              : "inherit",
                        }}
                      >
                        {selectedPeer.lost_hours}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Radar comparison */}
                {radarData.length > 0 && (
                  <div
                    className="card-flush"
                    style={{ padding: "16px 18px", marginBottom: 16 }}
                  >
                    <div className="label" style={{ marginBottom: 8 }}>
                      Dimension Comparison vs Benchmark
                    </div>
                    <ResponsiveContainer width="100%" height={230}>
                      <RadarChart
                        cx="50%"
                        cy="50%"
                        outerRadius="68%"
                        data={radarData}
                      >
                        <PolarGrid stroke="var(--border-default)" />
                        <PolarAngleAxis
                          dataKey="dim"
                          tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                        />
                        <Radar
                          name={selectedPeer.entity_name}
                          dataKey="selected"
                          stroke="var(--accent)"
                          fill="var(--accent)"
                          fillOpacity={0.2}
                          strokeWidth={2}
                        />
                        {selectedPlaybook && (
                          <Radar
                            name={selectedPlaybook.peer_name}
                            dataKey="benchmark"
                            stroke="#22c55e"
                            fill="#22c55e"
                            fillOpacity={0.12}
                            strokeWidth={2}
                          />
                        )}
                        <Legend wrapperStyle={{ fontSize: "0.7rem" }} />
                        <Tooltip contentStyle={customTooltipStyle()} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {selectedPlaybook ? (
                  <div className="card-flush" style={{ padding: "18px 18px" }}>
                    <div className="label" style={{ marginBottom: 10 }}>
                      Recommended benchmark
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {selectedPlaybook.peer_name}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 10,
                      }}
                    >
                      <span className="badge badge-success">
                        {selectedPlaybook.similarity_pct}% match
                      </span>
                      <span className="badge badge-warning">
                        {selectedPlaybook.performance_gap} health gap
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.84rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      {selectedPlaybook.playbook}
                    </p>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      No stronger peer was found for this node inside the
                      current filtered cohort.
                    </p>
                  </div>
                )}
                {weakestRows.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div className="label" style={{ marginBottom: 10 }}>
                      Channels needing intervention
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {weakestRows.map((row: HealthScoreItem) => (
                        <div
                          key={row.entity_id}
                          className="card-flush"
                          style={{ padding: "14px 16px" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                            }}
                          >
                            <div>{row.entity_name}</div>
                            <span className="badge badge-danger">
                              {row.health_score}
                            </span>
                          </div>
                          <p
                            style={{
                              marginTop: 8,
                              fontSize: "0.8rem",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {row.primary_issue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
