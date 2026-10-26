import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Token = { c: string; color?: string };
type Line = { t: "+" | "-" | " " | "gap" | "file"; n?: number; text?: string; tokens?: Token[] };
export type Kind = "what" | "why" | "check" | "decide" | "fix";
type Step = { from: number; to: number; kind: Kind; note: string; dur: number };
type Stop = { file: string; badge: string; adds: number; dels: number; lines: Line[]; steps: Step[] };

export type TourProps = {
  title: { kicker: string; title: string; status?: string; adds?: number; dels?: number };
  stops: Stop[];
  verdict: { headline: string; subhead?: string; items: { kind: Kind; text: string }[] };
};

const TITLE_FRAMES = 150;
const VERDICT_FRAMES = 270;

const C = {
  bg: "#0d1117",
  panel: "#010409",
  panel2: "#161b22",
  line: "#30363d",
  text: "#e6edf3",
  dim: "#8b949e",
  green: "#3fb950",
  red: "#f85149",
  amber: "#d29922",
  blue: "#58a6ff",
  purple: "#bc8cff",
};
const SANS = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

const KIND: Record<Kind, { label: string; color: string }> = {
  why: { label: "WHY", color: C.purple },
  what: { label: "WHAT IT DOES", color: C.blue },
  check: { label: "HUMAN: CHECK", color: C.amber },
  decide: { label: "HUMAN: DECIDE", color: C.amber },
  fix: { label: "FIX BEFORE RELEASE", color: C.red },
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fadeIn = (frame: number, start = 0, len = 12) => interpolate(frame, [start, start + len], [0, 1], clamp);

const Rise: React.FC<{ delay?: number; children: React.ReactNode }> = ({ delay = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>{children}</div>;
};

// `backticks` in narration become inline code.
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(`[^`]+`)/).map((part, i) =>
      part.startsWith("`") ? (
        <span key={i} style={{ fontFamily: MONO, fontSize: "0.84em", color: C.blue, background: "#1f2937", borderRadius: 6, padding: "1px 7px", whiteSpace: "nowrap" }}>
          {part.slice(1, -1)}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    )}
  </>
);

// ---------- Code stop ----------

const LINE_H = 32;
const CODE_FONT = 20;
const VIEW_H = 920;

const stopFrames = (s: Stop) => s.steps.reduce((n, st) => n + st.dur, 0);
export const tourFrames = (p: TourProps) => TITLE_FRAMES + p.stops.reduce((n, s) => n + stopFrames(s), 0) + VERDICT_FRAMES;
const badgeColor = (b: string) => (b.startsWith("CONTEXT") ? C.amber : b === "ADDED" ? C.green : b === "DELETED" ? C.red : C.blue);

const CodeStop: React.FC<{ stop: Stop; index: number; count: number }> = ({ stop, index, count }) => {
  const frame = useCurrentFrame();

  // Which step is active, and when it started.
  let acc = 0;
  let si = 0;
  for (; si < stop.steps.length - 1; si++) {
    if (frame < acc + stop.steps[si].dur) break;
    acc += stop.steps[si].dur;
  }
  const step = stop.steps[si];
  const prev = stop.steps[Math.max(0, si - 1)];
  const t = si === 0 ? 1 : interpolate(frame - acc, [0, 18], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });

  // Scroll so the focused range sits a bit above the middle of the view.
  const totalH = stop.lines.length * LINE_H;
  const scrollFor = (s: Step) => {
    const mid = ((s.from + s.to + 1) / 2) * LINE_H;
    return Math.max(0, Math.min(mid - VIEW_H * 0.42, totalH - VIEW_H + 40));
  };
  const scroll = interpolate(t, [0, 1], [scrollFor(prev), scrollFor(step)]);
  const focusFrom = Math.round(interpolate(t, [0, 1], [prev.from, step.from]));
  const focusTo = Math.round(interpolate(t, [0, 1], [prev.to, step.to]));
  const kind = KIND[step.kind];
  const total = stopFrames(stop);
  const stopOut = interpolate(frame, [total - 10, total], [1, 0], clamp);
  const isContext = stop.badge.startsWith("CONTEXT");

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.text, fontFamily: SANS, padding: "48px 56px", opacity: stopOut }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 22, opacity: fadeIn(frame, 0, 10) }}>
        <span style={{ fontFamily: MONO, color: C.dim, fontSize: 24 }}>
          {String(index + 1).padStart(2, "0")}/{count}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 32, fontWeight: 600 }}>{stop.file}</span>
        <span style={{ fontFamily: MONO, fontSize: 18, padding: "4px 12px", borderRadius: 999, color: badgeColor(stop.badge), border: `1.5px solid ${badgeColor(stop.badge)}` }}>
          {stop.badge}
        </span>
        {!isContext && (
          <span style={{ fontFamily: MONO, fontSize: 24 }}>
            {stop.adds > 0 && <span style={{ color: C.green }}>+{stop.adds} </span>}
            {stop.dels > 0 && <span style={{ color: C.red }}>−{stop.dels}</span>}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 36, flex: 1 }}>
        <div style={{ width: 1260, height: VIEW_H, overflow: "hidden", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14 }}>
          <div style={{ transform: `translateY(${-scroll + 16}px)` }}>
            {stop.lines.map((l, i) => {
              const inFocus = i >= focusFrom && i <= focusTo;
              const op = inFocus ? 1 : 0.3;
              if (l.t === "gap") {
                return (
                  <div key={i} style={{ height: LINE_H, display: "flex", alignItems: "center", paddingLeft: 30, color: C.dim, fontFamily: MONO, fontSize: 18, opacity: 0.6, background: "#0b1a2e" }}>
                    ⋯
                  </div>
                );
              }
              if (l.t === "file") {
                return (
                  <div key={i} style={{ height: LINE_H, display: "flex", alignItems: "center", paddingLeft: 30, color: C.purple, fontFamily: MONO, fontSize: 18, background: C.panel2, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                    {l.text}
                  </div>
                );
              }
              const bg = l.t === "+" ? "rgba(46,160,67,0.15)" : l.t === "-" ? "rgba(248,81,73,0.18)" : "transparent";
              const signColor = l.t === "+" ? C.green : l.t === "-" ? C.red : C.dim;
              return (
                <div key={i} style={{ height: LINE_H, display: "flex", alignItems: "center", background: bg, position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: inFocus ? kind.color : "transparent" }} />
                  <span style={{ width: 70, flexShrink: 0, textAlign: "right", fontFamily: MONO, fontSize: 17, color: C.dim, opacity: op, paddingRight: 12 }}>
                    {l.n}
                  </span>
                  <span style={{ width: 26, flexShrink: 0, fontFamily: MONO, fontSize: CODE_FONT, color: signColor, opacity: op }}>
                    {l.t === " " ? "" : l.t === "-" ? "−" : "+"}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: CODE_FONT, whiteSpace: "pre", opacity: op, textDecoration: l.t === "-" ? "line-through rgba(248,81,73,0.6)" : "none" }}>
                    {l.tokens?.map((tk, j) => (
                      <span key={j} style={{ color: tk.color }}>{tk.c}</span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", height: VIEW_H }}>
          <Sequence from={acc} durationInFrames={step.dur} layout="none" key={si}>
            <Narration kind={kind} note={step.note} />
          </Sequence>
          <div style={{ marginTop: "auto", display: "flex", gap: 10 }}>
            {stop.steps.map((s, i) => (
              <div key={i} style={{ height: 6, flex: 1, borderRadius: 3, background: i <= si ? KIND[s.kind].color : C.line, opacity: i === si ? 1 : 0.5 }} />
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Narration: React.FC<{ kind: { label: string; color: string }; note: string }> = ({ kind, note }) => (
  <>
    <Rise delay={8}>
      <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 20, letterSpacing: 2, color: kind.color, border: `2px solid ${kind.color}`, borderRadius: 999, padding: "6px 16px", marginBottom: 26 }}>
        {kind.label}
      </div>
    </Rise>
    <Rise delay={14}>
      <div style={{ fontSize: 32, lineHeight: 1.45 }}>
        <Rich text={note} />
      </div>
    </Rise>
  </>
);

// ---------- Bookends ----------

const Title: React.FC<{ title: TourProps["title"] }> = ({ title }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.text, fontFamily: SANS, justifyContent: "center", padding: "0 140px", opacity: interpolate(frame, [TITLE_FRAMES - 10, TITLE_FRAMES], [1, 0], clamp) }}>
      <Rise>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.blue, letterSpacing: 3, marginBottom: 18 }}>{title.kicker}</div>
      </Rise>
      <Rise delay={6}>
        <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.05, whiteSpace: "pre-line" }}>{title.title}</div>
      </Rise>
      <Rise delay={16}>
        <div style={{ display: "flex", gap: 28, marginTop: 46, fontFamily: MONO, fontSize: 30 }}>
          {title.status && <span style={{ color: C.purple }}>● {title.status}</span>}
          {title.adds != null && <span style={{ color: C.green }}>+{title.adds}</span>}
          {title.dels != null && <span style={{ color: C.red }}>−{title.dels}</span>}
        </div>
      </Rise>
      <div style={{ marginTop: 56, display: "flex", gap: 34, opacity: fadeIn(frame, 36, 20) }}>
        {(["what", "check", "decide", "fix"] as Kind[]).map((k) => (
          <span key={k} style={{ color: KIND[k].color, fontFamily: MONO, fontSize: 22 }}>■ {KIND[k].label}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Verdict: React.FC<{ verdict: TourProps["verdict"] }> = ({ verdict }) => (
  <AbsoluteFill style={{ background: C.bg, color: C.text, fontFamily: SANS, justifyContent: "center", padding: "0 140px" }}>
    <Rise>
      <div style={{ fontFamily: MONO, fontSize: 26, color: C.green, letterSpacing: 3, marginBottom: 18 }}>VERDICT</div>
    </Rise>
    <Rise delay={6}>
      <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.15 }}>
        {verdict.headline}
        {verdict.subhead && (
          <>
            <br />
            <span style={{ color: C.amber }}>{verdict.subhead}</span>
          </>
        )}
      </div>
    </Rise>
    <div style={{ marginTop: 46, fontSize: 36, lineHeight: 1.7 }}>
      {verdict.items.map((item, i) => (
        <Rise key={i} delay={20 + i * 10}>
          <div>
            <span style={{ color: KIND[item.kind].color }}>■</span>&nbsp;&nbsp;<Rich text={item.text} />
          </div>
        </Rise>
      ))}
    </div>
  </AbsoluteFill>
);

export const Tour: React.FC<TourProps> = (props) => {
  const scenes: [React.ReactNode, number][] = [
    [<Title title={props.title} />, TITLE_FRAMES],
    ...props.stops.map((s, i) => [<CodeStop stop={s} index={i} count={props.stops.length} />, stopFrames(s)] as [React.ReactNode, number]),
    [<Verdict verdict={props.verdict} />, VERDICT_FRAMES],
  ];
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {scenes.map(([node, d], i) => {
        const seq = (
          <Sequence key={i} from={from} durationInFrames={d}>
            {node}
          </Sequence>
        );
        from += d;
        return seq;
      })}
    </AbsoluteFill>
  );
};
