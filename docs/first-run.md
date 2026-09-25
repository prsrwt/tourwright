# First run on a clean machine

ROADMAP v0.1 item 1: `npx tourwright init`, then `npx tourwright make intro`, on Windows and Ubuntu,
with no undocumented step. This records that run.

## How it runs

[`.github/workflows/first-run.yml`](../.github/workflows/first-run.yml) runs the README's first
run on fresh GitHub runners (Ubuntu and Windows, Node 22 and 24). Each runner starts with empty
npm, Playwright and model caches. It creates a new Vite React app and runs the README's commands
in order, with the real voice model:

```sh
npm install -D tourwright                       # from a tarball, see below
npx tourwright init
npx playwright install --only-shell chromium
npm install -D ffmpeg-static                    # only because init asked for it
npx tourwright doctor
npx tourwright make intro
```

It runs on demand and whenever the workflow or `src/voice` changes. The MP4, contact sheet and
timing report are kept as artifacts of each run.

**One stand-in:** Tourwright is not on npm yet, so `npm install -D tourwright` installs a tarball
packed from the same commit (`npm pack`). Everything after that is the README, unchanged. Once the
package is published, the first command can be run as written.

## Result, 2026-09-25

[Run 36110978555](https://github.com/prsrwt/tourwright/actions/runs/36110978555), commit a291566:
all four jobs passed. In each, `doctor` reported everything ok (the voice model "not downloaded
yet", as expected), the Kokoro model downloaded (about 326 MB), the intro was voiced with the real
voice and verified with 0 errors and 0 warnings, and a 14.6 s `intro.mp4` was written.

| Runner | Node | Whole job | `npm install` | Chromium | `make intro`, including the model download |
| --- | --- | --- | --- | --- | --- |
| Ubuntu | 22 | 76 s | 8 s | 4 s | 23 s |
| Ubuntu | 24 | 65 s | 7 s | 4 s | 16 s |
| Windows | 22 | 122 s | 11 s | 8 s | 29 s |
| Windows | 24 | 111 s | 12 s | 9 s | 24 s |

Every download the run made is in the README's "What gets downloaded, and where" table, and the
only warning, npm's install-script notice, is explained under "npm install-script warnings".

## What the first attempt found

The first run of this workflow failed on every runner: the model download gave up on
`tokenizer.json` with ESIZE. huggingface.co gzips small files, and fetch unzips them as it reads,
so the bytes on disk never matched the Content-Length it checked against. Nothing had caught it
because CI and the tests use the fake voice. The downloader now asks for the file uncompressed,
and `test/download.test.ts` covers a server that compresses.

## Not covered

- A physical laptop. GitHub runners are clean virtual machines, and fast network ones, so the
  download times above are better than a typical home connection.
- macOS, which item 1 does not ask for; the main CI makes the example there.
