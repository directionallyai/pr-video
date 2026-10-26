// Turns a tour spec (spec.json, written by the reviewer) into tour.json, the props the
// Remotion composition renders: every stop's lines from the real diff or file, tokenized by
// Shiki, and every step resolved from a text anchor to display-line indices.
//
// Usage: node build-tour.mjs <spec.json> <tour.json>
// See README.md for the spec format.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { codeToTokens } from "shiki";

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error("Usage: node build-tour.mjs <spec.json> <tour.json>");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const REPO = resolvePath(dirname(specPath), spec.repo);
const THEME = "github-dark-default";
const KINDS = ["what", "why", "check", "decide", "fix"];

const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });

// `git diff -U<ctx>` for one file as display lines: + / - / space, and "gap" between hunks.
// + and context lines carry new-file numbers, - lines old-file numbers.
const diffLines = (file, ctx) => {
  const out = [];
  let oldN = 0;
  let newN = 0;
  let started = false;
  for (const raw of git("diff", `-U${ctx}`, spec.base, spec.head, "--", file).split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      if (started) out.push({ t: "gap" });
      started = true;
      oldN = +hunk[1];
      newN = +hunk[2];
      continue;
    }
    if (!started || raw.startsWith("\\")) continue;
    const t = raw[0];
    const text = raw.slice(1);
    if (t === "+") out.push({ t, n: newN++, text });
    else if (t === "-") out.push({ t, n: oldN++, text });
    else if (t === " ") {
      out.push({ t, n: newN++, text });
      oldN++;
    }
  }
  if (!out.length) throw new Error(`no diff for ${file} between ${spec.base} and ${spec.head}`);
  return out;
};

// Lines from..to (1-based, inclusive) of a file as it is at spec.head.
const snippet = (file, from, to) =>
  git("show", `${spec.head}:${file}`)
    .split("\n")
    .slice(from - 1, to)
    .map((text, i) => ({ t: " ", n: from + i, text }));

const highlight = async (lines, lang) => {
  const code = lines.filter((l) => l.t !== "gap").map((l) => l.text).join("\n");
  const { tokens } = await codeToTokens(code, { lang, theme: THEME });
  let i = 0;
  return lines.map((l) =>
    l.t === "gap" ? l : { ...l, tokens: tokens[i++].map((tk) => ({ c: tk.content, color: tk.color })) },
  );
};

const sourceLines = async (src) => {
  if (src.diff) return highlight(diffLines(src.diff, src.context ?? 6), src.lang);
  if (src.snippet) return highlight(snippet(src.snippet, src.from, src.to), src.lang);
  throw new Error(`source needs "diff" or "snippet": ${JSON.stringify(src)}`);
};

// A step points at the first display line containing `at` (at or after the first line
// containing `after`, if given) and focuses `span` lines from there.
const resolveStep = (lines, s, file) => {
  if (!KINDS.includes(s.kind)) throw new Error(`${file}: unknown step kind "${s.kind}"`);
  const start = s.after ? lines.findIndex((l) => l.text?.includes(s.after)) : 0;
  if (start < 0) throw new Error(`${file}: "after" anchor not found: ${s.after}`);
  const from = lines.findIndex((l, i) => i >= start && l.text?.includes(s.at));
  if (from < 0) throw new Error(`${file}: step anchor not found: ${s.at}`);
  const to = Math.min(lines.length - 1, from + (s.span ?? 1) - 1);
  const words = s.note.split(/\s+/).length;
  return { from, to, kind: s.kind, note: s.note, dur: Math.round(70 + words * 7.5) };
};

const stops = [];
for (const stop of spec.stops) {
  const sources = stop.sources ?? [stop];
  let lines = [];
  for (const src of sources) {
    // Several sources in one stop are separated by a header line naming each file.
    if (sources.length > 1) lines.push({ t: "file", text: src.diff ?? src.snippet });
    lines.push(...(await sourceLines(src)));
  }
  const steps = stop.steps.map((s) => resolveStep(lines, s, stop.file));
  stops.push({
    file: stop.file,
    badge: stop.badge,
    adds: lines.filter((l) => l.t === "+").length,
    dels: lines.filter((l) => l.t === "-").length,
    lines,
    steps,
  });
}

writeFileSync(outPath, JSON.stringify({ title: spec.title, stops, verdict: spec.verdict }));
for (const s of stops) console.log(`${s.file}: ${s.lines.length} lines, ${s.steps.length} steps`);
const frames = 150 + stops.reduce((n, s) => n + s.steps.reduce((m, st) => m + st.dur, 0), 0) + 270;
console.log(`total: ${(frames / 30).toFixed(0)}s`);
