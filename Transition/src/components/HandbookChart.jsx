import { useEffect, useRef, useState } from "react";

/**
 * Dependency-free SVG charts for the handbook: bar, pie, line and progress.
 * Charts are responsive (viewBox + width:100%) and themable.
 *
 * Motion: each chart grows in the first time it scrolls into view — bars
 * rise, slices spin open, rings and lines draw — and again when its type is
 * changed in the editor. Marks only transition transform / opacity / stroke
 * dashes (styles/handbook-motion.css); prefers-reduced-motion shows the
 * finished chart straight away.
 */
const PALETTE = ["#10b981", "#6366f1", "#f59e0b", "#f43f5e", "#06b6d4", "#8b5cf6", "#14b8a6", "#ef4444"];

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function polar(cx, cy, r, angle) {
  const a = (angle - 90) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/**
 * Non-null once the chart has been on screen. Carries the delay (ms) its
 * block's own reveal is still waiting (--hbm-d, set inline by the handbook's
 * revealer just before), so the marks grow as the block lands, not before.
 */
function useFirstSight(ref) {
  const [sight, setSight] = useState(() => (reducedMotion() || typeof IntersectionObserver === "undefined" ? { delay: 0 } : null));
  useEffect(() => {
    if (sight) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const d = parseFloat(el.closest(".hb-block")?.style.getPropertyValue("--hbm-d")) || 0;
      setSight({ delay: d });
    }, { rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [sight, ref]);
  return sight;
}

/** Turns true two frames after `go`, so the empty state paints first and the CSS transitions run. */
function useGrow(go) {
  const [on, setOn] = useState(() => !!go && reducedMotion());
  useEffect(() => {
    if (!go || on) return undefined;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setOn(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [go, on]);
  return on;
}

export default function HandbookChart({ kind = "bar", title, data = [] }) {
  const rootRef = useRef(null);
  const sight = useFirstSight(rootRef);
  const [firstKind] = useState(kind);
  const go = !!sight;
  // Only the first appearance waits for the block's reveal; a type change in
  // the editor replays immediately.
  const delay = sight && kind === firstKind ? sight.delay : 0;

  const clean = (data || []).map((d) => ({ label: String(d.label ?? ""), value: Number(d.value) || 0 }));
  const max = Math.max(1, ...clean.map((d) => d.value));
  const total = clean.reduce((s, d) => s + d.value, 0) || 1;
  const hasLegend = kind === "pie" || kind === "donut" || kind === "radial";

  return (
    <div ref={rootRef} className="hb-chart" style={{ "--hbm-cd": `${delay}ms` }}>
      {title ? <div className="hb-chart-title">{title}</div> : null}
      {clean.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontSize: "0.78rem", padding: "20px 0" }}>
          No data yet.
        </div>
      ) : kind === "bar" ? (
        <BarChart key={kind} clean={clean} max={max} go={go} />
      ) : kind === "hbar" ? (
        <HBarChart key={kind} clean={clean} max={max} go={go} />
      ) : kind === "pie" ? (
        <PieChart key={kind} clean={clean} total={total} go={go} />
      ) : kind === "donut" ? (
        <PieChart key={kind} clean={clean} total={total} go={go} donut />
      ) : kind === "line" ? (
        <LineChart key={kind} clean={clean} max={max} go={go} />
      ) : kind === "area" ? (
        <LineChart key={kind} clean={clean} max={max} go={go} area />
      ) : kind === "radial" ? (
        <RadialChart key={kind} clean={clean} max={max} go={go} />
      ) : (
        <ProgressChart key={kind} clean={clean} max={max} go={go} />
      )}

      {hasLegend && clean.length > 0 && (
        <div className={`hb-chart-legend hbm-legend ${go ? "is-on" : ""}`}>
          {clean.map((d, i) => (
            <span key={i} style={{ "--i": i }}><i style={{ background: PALETTE[i % PALETTE.length] }} />{d.label} ({Math.round((d.value / total) * 100)}%)</span>
          ))}
        </div>
      )}
    </div>
  );
}

function BarChart({ clean, max, go }) {
  const on = useGrow(go);
  const W = 320, H = 190, pad = 28, gap = 12;
  const n = clean.length;
  const barW = (W - pad * 2 - gap * (n - 1)) / n;
  const chartH = H - pad - 24;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <line x1={pad} y1={H - 24} x2={W - pad} y2={H - 24} stroke="var(--glass-border)" strokeWidth="1" />
      {clean.map((d, i) => {
        const h = (d.value / max) * chartH;
        const x = pad + i * (barW + gap);
        const y = H - 24 - h;
        return (
          <g key={i}>
            <rect className="hbm-bar" style={{ "--i": i, transform: on ? "scaleY(1)" : "scaleY(0)" }} x={x} y={y} width={barW} height={h} rx="4" fill={PALETTE[i % PALETTE.length]} />
            <text className="hbm-val" style={{ "--i": i, opacity: on ? 1 : 0 }} x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-text-secondary)">{d.value}</text>
            <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize="8.5" fill="var(--color-text-secondary)">{truncate(d.label, 8)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ clean, total, donut, go }) {
  const on = useGrow(go);
  const cx = 90, cy = 90, r = 80;
  let acc = 0;
  const slice = (i) => ({ "--i": i, transform: on ? "none" : "scale(0.55) rotate(-40deg)", opacity: on ? 1 : 0 });
  return (
    <svg width="100%" viewBox="0 0 180 180" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxWidth: 220, margin: "0 auto" }}>
      {clean.map((d, i) => {
        const startA = (acc / total) * 360;
        acc += d.value;
        const endA = (acc / total) * 360;
        const [x1, y1] = polar(cx, cy, r, startA);
        const [x2, y2] = polar(cx, cy, r, endA);
        const large = endA - startA > 180 ? 1 : 0;
        if (clean.length === 1) {
          return <circle key={i} className="hbm-slice" style={slice(0)} cx={cx} cy={cy} r={r} fill={PALETTE[0]} />;
        }
        return (
          <path key={i} className="hbm-slice" style={slice(i)} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={PALETTE[i % PALETTE.length]} stroke="var(--color-card-bg)" strokeWidth="1.5" />
        );
      })}
      {donut && (
        <g className="hbm-val hbm-donut-hole" style={{ "--i": clean.length, opacity: on ? 1 : 0 }}>
          <circle cx={cx} cy={cy} r={r * 0.58} fill="var(--color-card-bg)" />
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="900" fill="var(--color-text-primary)">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--color-text-secondary)">TOTAL</text>
        </g>
      )}
    </svg>
  );
}

function HBarChart({ clean, max, go }) {
  const on = useGrow(go);
  const rowH = 30, gap = 10, labelW = 80, W = 320;
  const H = clean.length * (rowH + gap);
  const barMax = W - labelW - 36;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {clean.map((d, i) => {
        const y = i * (rowH + gap);
        const w = Math.max(2, (d.value / max) * barMax);
        return (
          <g key={i}>
            <text x={labelW - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="9.5" fontWeight="600" fill="var(--color-text-secondary)">{truncate(d.label, 11)}</text>
            <rect className="hbm-hbar" style={{ "--i": i, transform: on ? "scaleX(1)" : "scaleX(0)" }} x={labelW} y={y + 4} width={w} height={rowH - 8} rx="4" fill={PALETTE[i % PALETTE.length]} />
            <text className="hbm-val" style={{ "--i": i, opacity: on ? 1 : 0 }} x={labelW + w + 5} y={y + rowH / 2 + 3} fontSize="9.5" fontWeight="700" fill="var(--color-text-secondary)">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RadialChart({ clean, max, go }) {
  const on = useGrow(go);
  const cx = 90, cy = 90;
  const rings = clean.slice(0, 5);
  return (
    <svg width="100%" viewBox="0 0 180 180" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxWidth: 220, margin: "0 auto" }}>
      {rings.map((d, i) => {
        const r = 78 - i * 15;
        const circ = 2 * Math.PI * r;
        const pct = Math.min(1, d.value / max);
        return (
          <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-bg-subtle)" strokeWidth="9" />
            <circle
              className="hbm-ring"
              cx={cx} cy={cy} r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="9" strokeLinecap="round"
              style={{ "--i": i, strokeDasharray: `${circ} ${circ}`, strokeDashoffset: on ? circ * (1 - pct) : circ }}
            />
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ clean, max, area: isArea, go }) {
  const on = useGrow(go);
  const W = 320, H = 180, pad = 28;
  const chartH = H - pad - 24;
  const n = clean.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = clean.map((d, i) => {
    const x = pad + i * step;
    const y = H - 24 - (d.value / max) * chartH;
    return [x, y];
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const area = `${path} L ${pts[pts.length - 1][0]} ${H - 24} L ${pts[0][0]} ${H - 24} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <line x1={pad} y1={H - 24} x2={W - pad} y2={H - 24} stroke="var(--glass-border)" strokeWidth="1" />
      <path className="hbm-area" d={area} fill={PALETTE[0]} style={{ opacity: on ? (isArea ? 0.28 : 0.12) : 0 }} />
      <path className="hbm-line" pathLength="1" d={path} fill="none" stroke={PALETTE[0]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: "1", strokeDashoffset: on ? "0" : "1" }} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle className="hbm-dot" style={{ "--t": `${Math.round((i * 700) / Math.max(1, n - 1))}ms`, transform: on ? "scale(1)" : "scale(0)" }} cx={p[0]} cy={p[1]} r="3.5" fill={PALETTE[0]} />
          <text x={p[0]} y={H - 10} textAnchor="middle" fontSize="8.5" fill="var(--color-text-secondary)">{truncate(clean[i].label, 8)}</text>
        </g>
      ))}
    </svg>
  );
}

function ProgressChart({ clean, max, go }) {
  const on = useGrow(go);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
      {clean.map((d, i) => {
        const pct = Math.round((d.value / max) * 100);
        return (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 4 }}>
              <span>{d.label}</span><span>{d.value}</span>
            </div>
            <div style={{ height: 8, background: "var(--color-bg-subtle)", borderRadius: 8, overflow: "hidden" }}>
              <div className="hbm-prog" style={{ "--i": i, height: "100%", width: `${pct}%`, background: PALETTE[i % PALETTE.length], borderRadius: 8, transform: on ? "scaleX(1)" : "scaleX(0)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
