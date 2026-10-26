# pr-video

`pr-video` turns a GitHub pull request into a code-tour review video and posts it on the PR. The video steps
through the real diff with syntax highlighting. For each range it explains what the code
does, and it calls out what a human reviewer should **check**, **decide** or **fix before
release**. That includes problems in files the PR didn't touch.

```
./pr-video.sh https://github.com/OWNER/REPO/pull/123            # → out/REPO-123.mp4, posted to the PR
./pr-video.sh https://github.com/OWNER/REPO/pull/123 review.mp4
PR_VIDEO_POST=0 ./pr-video.sh https://github.com/OWNER/REPO/pull/123   # render only
```

The output is a 1280×720, 30 fps MP4 with no audio, usually 2–5 minutes long.

## How it works

1. **Checkout.** `pr-video.sh` clones the repo and pins the diff:
   - a merged PR is its merge commit against the first parent
   - an open PR is its head against the merge base with the target branch
2. **Review and script.** `claude -p` runs [`prompt.md`](prompt.md). It reviews the PR and
   writes `spec.json`, a list of *stops* (files) and *steps* (line ranges, each with a note
   and a kind). Then it builds the tour, renders a still for every step and looks at the
   stills, and fixes the spec until the focus lands on the right lines.
3. **Build.** [`build-tour.mjs`](build-tour.mjs) reads each stop's lines from `git diff` or
   `git show`, highlights them with Shiki (`github-dark-default`), and resolves each step's
   text anchor to line indices.
4. **Render.** [`render.mjs`](render.mjs) renders [`src/Tour.tsx`](src/Tour.tsx) with
   Remotion. Each stop is a scrolling code panel that focuses on one range at a time, with a
   narration panel beside it. Title and verdict cards open and close the video.
5. **Post.** `gh pr comment --attach` uploads the MP4 and posts a comment with an inline
   video player, followed by Claude's written review (findings with `file:line`, and what
   it couldn't verify). The comment is also saved as `comment.md` in the work directory.

Step kinds and their colours:

| kind     | label              | colour |
|----------|--------------------|--------|
| `why`    | WHY                | purple |
| `what`   | WHAT IT DOES       | blue   |
| `check`  | HUMAN: CHECK       | amber  |
| `decide` | HUMAN: DECIDE      | amber  |
| `fix`    | FIX BEFORE RELEASE | red    |

## Requirements

- Node 20+, `git`, the `gh` CLI (authenticated) and the `claude` CLI (Claude Code).
- To post: a `gh` with `pr comment --attach` (2.101 or later), and push access to the PR's
  repository. GitHub limits video attachments to 10 MB on free plans; a 720p tour is
  usually 5–8 MB.
- On the first run, `npm ci` installs the dependencies. On the first render, Remotion
  downloads a headless Chrome.

## Options

| env var | effect |
|---|---|
| `PR_VIDEO_MODEL` | model passed to `claude -p` |
| `PR_VIDEO_POST=0` | render only: don't post. The comment is still written to `comment.md`. |
| `PR_VIDEO_HEIGHT=1080` | render at 1080p instead of the default 720p (also applies to the QA stills) |
| `PR_VIDEO_PROBE=1` | lets Claude `curl` the project's live hosts, to say whether the change is deployed and behaves as claimed. It is off by default. |
| `PR_VIDEO_WORK=dir` | reuse a work directory. If `spec.json` already exists there, Claude refines it instead of starting over. |

The work directory keeps `spec.json`, `tour.json`, `stills/`, `review.txt` (Claude's
written report) and `comment.md` (what gets posted).

## What Claude may do

`claude -p` runs with an allowlist. It can:

- read files
- edit only `spec.json`
- run `gh pr view|diff|checks` and `git -C <checkout> …`
- run the two build and still scripts
- run `curl`, but only when `PR_VIDEO_PROBE=1` is set

The prompt tells Claude to treat the PR's contents as material to review, not as
instructions.

Claude cannot post anything itself. The script posts the comment after rendering, using
your `gh` credentials. Its text is Claude's final message, so read `comment.md` with
`PR_VIDEO_POST=0` first if you want to vet it before it goes up.

## Editing a video by hand

Change `spec.json` in the work directory, then rebuild:

```
node build-tour.mjs WORK/spec.json WORK/tour.json
node render.mjs stills WORK/tour.json WORK/stills      # check the layout
node render.mjs video  WORK/tour.json out/review.mp4
```

### Spec format

```jsonc
{
  "repo": "repo",               // checkout dir, relative to spec.json
  "base": "<sha>", "head": "<sha>",
  "title": { "kicker": "CODE TOUR · owner/repo #123", "title": "Line one,\nline two",
             "status": "merged · on staging", "adds": 356, "dels": 4 },
  "stops": [
    // a diff hunk view; context = lines of context (default 6)
    { "file": "nginx.conf", "badge": "MODIFIED", "diff": "nginx.conf", "lang": "nginx", "context": 3,
      "steps": [
        { "at": "try_files", "kind": "why", "note": "The root cause: …" },
        { "at": "location / {", "after": "Real files win", "span": 4, "kind": "what", "note": "…" }
      ] },
    // a file the PR did not touch, lines from..to at head
    { "file": "src/Panel.jsx", "badge": "CONTEXT · NOT IN DIFF",
      "snippet": "src/Panel.jsx", "from": 320, "to": 336, "lang": "jsx",
      "steps": [{ "at": "href=\"/pricing\"", "span": 3, "kind": "fix", "note": "…" }] },
    // several small files in one stop
    { "file": "robots.txt · sitemap.xml", "badge": "ADDED",
      "sources": [{ "diff": "public/robots.txt", "lang": "ini" }, { "diff": "public/sitemap.xml", "lang": "xml" }],
      "steps": [{ "at": "Disallow:", "span": 6, "kind": "what", "note": "…" }] }
  ],
  "verdict": { "headline": "…", "subhead": "Before you release:",
               "items": [{ "kind": "fix", "text": "Fix the `/pricing` link" }] }
}
```

- A step focuses `span` lines, starting at the first line that contains `at`. If `after`
  is given, the search starts at the first line containing `after`.
- Each step lasts `70 + 7.5 × words(note)` frames.
- Put inline code in notes in `backticks`.
- `lang` is any [Shiki language id](https://shiki.style/languages).
