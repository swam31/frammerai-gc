import Link from "next/link";
import { Highlight } from "@/components/ui/hero-highlight";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Tooltip } from "@/components/ui/tooltip-card";
import type { IconType } from "react-icons";
import {
  HiArrowUpRight,
  HiBolt,
  HiChartBar,
  HiClock,
  HiMagnifyingGlass,
  HiBuildingOffice2,
  HiPencilSquare,
  HiCheckBadge,
  HiChartBarSquare,
  HiFilm,
  HiCpuChip,
  HiBuildingOffice,
  HiCalculator,
  HiSparkles,
} from "react-icons/hi2";

// const pages = [
//   {
//     href: "/executive-summary",
//     title: "Executive Summary",
//     description:
//       "High-level overview of pipeline performance, volume trends, and key business indicators.",
//   },
//   {
//     href: "/control-tower",
//     title: "Control Tower",
//     description:
//       "Central operational view to monitor system activity, workflow status, and exceptions.",
//   },
//   {
//     href: "/explorer",
//     title: "Explorer",
//     description:
//       "Flexible exploration workspace for slicing, filtering, and drilling into dataset details.",
//   },
//   {
//     href: "/entities",
//     title: "Entities",
//     description:
//       "Entity-level analytics across clients, channels, teams, and related dimensions.",
//   },
//   {
//     href: "/content",
//     title: "Content",
//     description:
//       "Content-focused insights including output types, publishing behavior, and engagement patterns.",
//   },
//   {
//     href: "/quality",
//     title: "Quality",
//     description:
//       "Quality and reliability metrics highlighting data completeness, anomalies, and consistency.",
//   },
//   {
//     href: "/usage",
//     title: "Usage",
//     description:
//       "User and platform usage analytics showing adoption, activity trends, and retention signals.",
//   },
//   {
//     href: "/videos",
//     title: "Videos",
//     description:
//       "Video-level views for upload, processing, and publish lifecycle performance tracking.",
//   },
//   {
//     href: "/nlp-pipeline",
//     title: "NLP Pipeline",
//     description:
//       "Language and NLP workflow monitoring for extraction, transformation, and enrichment stages.",
//   },
// ];

const pages: {
  href: string;
  title: string;
  icon: IconType;
  tag: string;
  description: string;
}[] = [
  {
    href: "/executive-summary",
    title: "Executive Summary",
    icon: HiChartBar,
    tag: "Overview",
    description:
      "High-level pipeline performance, volume trends, and key business indicators at a glance.",
  },
  {
    href: "/control-tower",
    title: "Control Tower",
    icon: HiBuildingOffice,
    tag: "Operations",
    description:
      "Central operational view for system activity, workflow status, and exception management.",
  },
  {
    href: "/explorer",
    title: "Explorer",
    icon: HiMagnifyingGlass,
    tag: "Analysis",
    description:
      "Flexible workspace for slicing, filtering, and drilling into dataset details on-demand.",
  },
  {
    href: "/entities",
    title: "Entities",
    icon: HiBuildingOffice2,
    tag: "Entities",
    description:
      "Entity-level analytics across clients, channels, teams, and related dimensions.",
  },
  {
    href: "/content",
    title: "Content",
    icon: HiPencilSquare,
    tag: "Content",
    description:
      "Output types, publishing behavior, and engagement pattern insights across content.",
  },
  {
    href: "/quality",
    title: "Quality",
    icon: HiCheckBadge,
    tag: "Quality",
    description:
      "Reliability metrics highlighting data completeness, anomalies, and consistency signals.",
  },
  {
    href: "/usage",
    title: "Usage",
    icon: HiChartBarSquare,
    tag: "Platform",
    description:
      "User and platform analytics showing adoption, activity trends, and retention signals.",
  },
  {
    href: "/videos",
    title: "Videos",
    icon: HiFilm,
    tag: "Media",
    description:
      "Upload, processing, and publish lifecycle performance tracking at the video level.",
  },
  {
    href: "/nlp-pipeline",
    title: "NLP Pipeline",
    icon: HiCpuChip,
    tag: "AI / NLP",
    description:
      "Language workflow monitoring for extraction, transformation, and enrichment stages.",
  },
  {
    href: "/custom-kpis",
    title: "Custom KPIs",
    icon: HiCalculator,
    tag: "New KPIs",
    description:
      "Create permanent KPIs from natural language or SQL and view the stored value or table output.",
  },
];

export default function LandingPage() {
  const spotlightPages = pages.slice(0, 3);
  const corePages = pages.slice(3);

  return (
    <main className="page-container">
      <section className="page-header">
          <h1
            className="text-center text-5xl font-extrabold tracking-tight md:text-7xl"
            style={{ color: "var(--text-primary)" }}
          >
            Frammer Analytics <Highlight className="text-white">&nbsp;Dashboard&nbsp;</Highlight>
          </h1>
          <div style={{ marginTop: 10, maxWidth: 820, marginInline: "auto", textAlign: "center" }}>
            <TextGenerateEffect
              words="A fast, focused analytics workspace for monitoring content pipelines, teams, and platform performance."
              className="text-center md:text-lg"
              duration={1}
            />
          </div>
      </section>
      {/* <section className="landing-kpi-strip section-gap">
        <article className="landing-kpi-card">
          <span className="landing-kpi-label">
            <HiBolt size={14} /> Live Dashboards
          </span>
          <p className="landing-kpi-value">{pages.length}</p>
          <p className="landing-kpi-meta">Ready modules with instant drill-down</p>
        </article>
        <article className="landing-kpi-card">
          <span className="landing-kpi-label">
            <HiSparkles size={14} /> Fast Navigation
          </span>
          <p className="landing-kpi-value">1 Click</p>
          <p className="landing-kpi-meta">Jump from overview to deep analysis</p>
        </article>
        <article className="landing-kpi-card">
          <span className="landing-kpi-label">
            <HiClock size={14} /> Workflow Mode
          </span>
          <p className="landing-kpi-value">Realtime</p>
          <p className="landing-kpi-meta">Preview every page before opening</p>
        </article>
      </section> */}

      <section className="landing-spotlight section-gap">
        <div className="landing-spotlight-head">
          <p className="landing-eyebrow">Spotlight Dashboards</p>
          <p className="landing-spotlight-copy">
            Start with these high-impact views to get the fastest situational awareness.
          </p>
        </div>
        <div className="landing-spotlight-grid">
          {spotlightPages.map((page, idx) => {
            const Icon = page.icon;
            return (
              <article key={page.href} className="landing-spotlight-card">
                <span className="landing-spotlight-serial">{String(idx + 1).padStart(2, "0")}</span>
                <div className="landing-spotlight-title-row">
                  <div className="landing-spotlight-icon">
                    <Icon size={17} aria-hidden="true" />
                  </div>
                  <span className="landing-spotlight-tag">{page.tag}</span>
                </div>
                <h2>{page.title}</h2>
                <p>{page.description}</p>
                <Link href={page.href} className="landing-open-link">
                  <Tooltip
                    content={
                      <div style={{ width: 460 }}>
                        <div
                          style={{
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 16,
                            overflow: "hidden",
                            background: "var(--bg-surface-solid)",
                          }}
                        >
                          <iframe
                            src={`${page.href}?preview=1`}
                            title={`Preview ${page.title}`}
                            style={{
                              width: "100%",
                              height: 280,
                              border: "none",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      </div>
                    }
                  >
                    <span className="landing-open-link-inner">
                      Open dashboard <HiArrowUpRight size={14} />
                    </span>
                  </Tooltip>
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-all section-gap">
        <div className="landing-all-head">
          <p className="landing-eyebrow">All Dashboards</p>
          <p className="landing-all-copy">Navigate every workspace from one premium control surface.</p>
        </div>
        <div className="landing-all-grid">
          {corePages.map((page, idx) => {
            const Icon = page.icon;
            return (
              <article key={page.href} className="landing-module-card">
                <div className="landing-module-top">
                  <div className="landing-module-icon">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <span className="landing-module-tag">{page.tag}</span>
                </div>
                <h3>{page.title}</h3>
                <p>{page.description}</p>
                <Link href={page.href} className="landing-open-link">
                  <Tooltip
                    content={
                      <div style={{ width: 460 }}>
                        <div
                          style={{
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 16,
                            overflow: "hidden",
                            background: "var(--bg-surface-solid)",
                          }}
                        >
                          <iframe
                            src={`${page.href}?preview=1`}
                            title={`Preview ${page.title}`}
                            style={{
                              width: "100%",
                              height: 280,
                              border: "none",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      </div>
                    }
                  >
                    <span className="landing-open-link-inner">
                      Launch module <HiArrowUpRight size={14} />
                    </span>
                  </Tooltip>
                </Link>
                <span className="landing-module-serial">{String(idx + 4).padStart(2, "0")}</span>
              </article>
            );
          })}
        </div>
      </section>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
        .landing-kpi-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .landing-kpi-card {
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          background: linear-gradient(160deg, var(--bg-surface-solid) 0%, color-mix(in oklab, var(--bg-surface-solid), var(--accent) 8%) 100%);
          padding: 1rem 1.1rem;
          box-shadow: var(--shadow-sm);
        }

        .landing-kpi-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .landing-kpi-value {
          margin-top: 0.5rem;
          font-family: 'Syne', sans-serif;
          font-size: clamp(1.5rem, 2.5vw, 2.1rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          color: var(--text-primary);
        }

        .landing-kpi-meta {
          margin-top: 0.4rem;
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .landing-spotlight {
          position: relative;
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          background:
            radial-gradient(circle at 10% 10%, var(--accent-glow-soft) 0%, transparent 55%),
            radial-gradient(circle at 90% 90%, color-mix(in oklab, var(--accent), transparent 85%) 0%, transparent 45%),
            var(--bg-surface);
          padding: 1.3rem;
        }

        .landing-spotlight-head,
        .landing-all-head {
          margin-bottom: 1rem;
        }

        .landing-eyebrow {
          font-size: 0.67rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 700;
          margin-bottom: 0.45rem;
        }

        .landing-spotlight-copy,
        .landing-all-copy {
          font-size: 0.88rem;
          line-height: 1.6;
          color: var(--text-secondary);
          max-width: 70ch;
        }

        .landing-spotlight-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .landing-spotlight-card {
          position: relative;
          min-height: 220px;
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          background: linear-gradient(155deg, var(--bg-surface-solid) 0%, color-mix(in oklab, var(--bg-surface-solid), var(--accent) 10%) 100%);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease;
        }

        .landing-spotlight-card:hover {
          transform: translateY(-2px);
          border-color: var(--border-default);
          box-shadow: var(--shadow-md), var(--shadow-glow);
        }

        .landing-spotlight-serial {
          position: absolute;
          top: 10px;
          right: 12px;
          font-size: 0.66rem;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          font-weight: 600;
        }

        .landing-spotlight-title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.85rem;
        }

        .landing-spotlight-icon,
        .landing-module-icon {
          width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: color-mix(in oklab, var(--accent), transparent 87%);
          color: var(--text-accent);
        }

        .landing-spotlight-tag,
        .landing-module-tag {
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 700;
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 0.2rem 0.52rem;
        }

        .landing-spotlight-card h2 {
          font-family: 'Syne', sans-serif;
          font-size: 1rem;
          margin-bottom: 0.55rem;
        }

        .landing-spotlight-card p,
        .landing-module-card p {
          color: var(--text-secondary);
          line-height: 1.6;
          font-size: 0.8rem;
          flex: 1;
        }

        .landing-open-link {
          margin-top: 0.95rem;
          text-decoration: none;
          color: var(--accent);
          font-size: 0.78rem;
          font-weight: 600;
        }

        .landing-open-link-inner {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .landing-all-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 12px;
        }

        .landing-module-card {
          position: relative;
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 0.95rem;
          min-height: 210px;
          background: var(--bg-surface-solid);
          display: flex;
          flex-direction: column;
          transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease;
        }

        .landing-module-card:hover {
          transform: translateY(-2px);
          border-color: var(--border-default);
          box-shadow: var(--shadow-md);
        }

        .landing-module-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.8rem;
        }

        .landing-module-card h3 {
          font-size: 0.95rem;
          margin-bottom: 0.45rem;
        }

        .landing-module-serial {
          position: absolute;
          right: 12px;
          bottom: 10px;
          font-size: 0.64rem;
          color: var(--text-muted);
          letter-spacing: 0.08em;
          font-weight: 600;
        }

        @media (max-width: 980px) {
          .landing-kpi-strip,
          .landing-spotlight-grid {
            grid-template-columns: 1fr;
          }

          .landing-spotlight,
          .landing-kpi-card,
          .landing-module-card {
            border-radius: 14px;
          }
        }
      `}</style>
    </main>
  );
}