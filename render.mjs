// Renders a tour.json with the Tour composition. Bundles once per run.
//
//   node render.mjs stills <tour.json> <out-dir>   one PNG per step, at 60% of the step,
//                                                  plus the title and verdict cards
//   node render.mjs video  <tour.json> <out.mp4>
//
// The composition is laid out at 1920×1080 and rendered at 720p (scale 2/3) by default;
// PR_VIDEO_HEIGHT=1080 renders it at full size.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, tourPath, out] = process.argv.slice(2);
if (!["stills", "video"].includes(mode) || !tourPath || !out) {
  console.error("Usage: node render.mjs stills <tour.json> <out-dir> | video <tour.json> <out.mp4>");
  process.exit(2);
}
const inputProps = JSON.parse(readFileSync(tourPath, "utf8"));
const here = dirname(fileURLToPath(import.meta.url));
const serveUrl = await bundle({ entryPoint: join(here, "src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "Tour", inputProps });
const scale = Number(process.env.PR_VIDEO_HEIGHT ?? 720) / composition.height;

if (mode === "video") {
  mkdirSync(dirname(out), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    scale,
    outputLocation: out,
    onProgress: ({ progress }) => process.stdout.write(`\rrendering ${(progress * 100).toFixed(0)}%`),
  });
  console.log(`\n${out} (${Math.round(composition.width * scale)}×${Math.round(composition.height * scale)}, ${(composition.durationInFrames / 30).toFixed(0)}s)`);
} else {
  mkdirSync(out, { recursive: true });
  const shots = [["00-title", 100]];
  let f = 150;
  inputProps.stops.forEach((stop, i) =>
    stop.steps.forEach((st, j) => {
      shots.push([`${String(i + 1).padStart(2, "0")}-${j + 1}`, f + Math.round(st.dur * 0.6)]);
      f += st.dur;
    }),
  );
  shots.push(["99-verdict", f + 200]);
  for (const [name, frame] of shots) {
    await renderStill({ serveUrl, composition, inputProps, frame, scale, output: join(out, `${name}.png`) });
    console.log(join(out, `${name}.png`));
  }
}
