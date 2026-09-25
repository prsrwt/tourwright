// End to end on the example app: bundle its real components, verify with injected faults, and
// render twice to prove the frames are identical. Uses the fake voice, so no model is needed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScript } from '../src/check/check.ts';
import { resolveConfig, type ResolvedConfig } from '../src/config/config.ts';
import { prepare } from '../src/pipeline/prepare.ts';
import { openSession } from '../src/pipeline/session.ts';
import { findFfmpeg } from '../src/render/ffmpeg.ts';
import { renderVideo } from '../src/render/render.ts';
import { verifyWalkthrough } from '../src/verify/verify.ts';
import { verifyPrepared } from '../src/cli/verify.ts';
import { describeFrames } from '../src/cli/describe.ts';
import { formatScreen } from '../src/runtime/screen.ts';
import { settleFrame } from '../src/timing/timeline.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));
// Inside the app (so its aliases and CSS resolve) but in its git-ignored out folder.
const scratch = join(app, 'out', '.test', String(process.pid));
after(() => rmSync(scratch, { recursive: true, force: true }));

const quiet = () => undefined;

function setup(scripts: Record<string, unknown>, stages?: string): ResolvedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-e2e-'));
  for (const [name, script] of Object.entries(scripts)) {
    mkdirSync(join(dir, 'walkthroughs', name), { recursive: true });
    writeFileSync(join(dir, 'walkthroughs', name, 'script.json'), JSON.stringify(script));
  }
  let stagesFile: string | undefined;
  if (stages) {
    mkdirSync(scratch, { recursive: true });
    stagesFile = join(scratch, `stages-${Object.keys(scripts)[0]}.tsx`);
    writeFileSync(stagesFile, stages);
  }
  return resolveConfig(
    { walkthroughs: join(dir, 'walkthroughs'), out: join(dir, 'out'), ...(stagesFile && { stages: stagesFile }) },
    join(app, 'tourwright.config.mts'),
    { TOURWRIGHT_VOICE: 'fake' },
  );
}

test('the example walkthrough verifies clean against the real components', async () => {
  const base = setup({});
  const config = { ...base, walkthroughs: join(app, 'tourwright', 'walkthroughs') };
  const report = await verifyPrepared(config, await prepare(config, 'intro'), quiet);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.stills.length, 7, 'six beats, plus the moment the stat cards start counting');
  assert.ok(existsSync(report.files.contactSheet));
  assert.match(readFileSync(report.files.timing, 'utf8'), /\| overdue \| 4\.\d\d s \|/);
  // screen.md says, in words, what each still shows.
  const screen = readFileSync(report.files.screen, 'utf8');
  assert.equal(screen.match(/^## /gm)?.length, report.stills.length);
  assert.match(screen, /## stats-overdue\n\n```text\n[\d.]+ s · frame \d+ · scene "stats" \(scenes\[1\]\)\n[^`]*Narration box: stat-overdue\n {2}Inside it: {5}"Overdue 2 needs attention"/);
  assert.match(screen, /## stats-cards-before\n[^#]*Values: {8}counts = 0\.000 \(counting\)\n/);
});

test('new --from-stage drafts scenes and beats from what the stage renders, and the draft passes check', async () => {
  const config = setup({});
  const { runNew } = await import('../src/cli/new.ts');
  const { DraftError } = await import('../src/cli/draft.ts');
  const { log } = console;
  console.log = () => undefined;
  try {
    assert.equal(await runNew(config, 'dash', { fromStage: 'dashboard' }), 0);
    await assert.rejects(runNew(config, 'nope', { fromStage: 'dashbord' }), (e: Error) => e instanceof DraftError && /There is no stage "dashbord"\. Stages: [^]*"dashboard"[^]*Fix:/.test(e.message));
  } finally {
    console.log = log;
  }
  const script = JSON.parse(readFileSync(join(config.walkthroughs, 'dash', 'script.json'), 'utf8'));
  // An overview, then each top-level target in page order, with a beat for each target inside it.
  assert.deepEqual(script.scenes.map((s: { id: string }) => s.id), ['overview', 'stats', 'tasks']);
  assert.deepEqual(script.scenes[1].beats, [
    { at: 'stats', camera: { to: 'stats', zoom: 'fit' }, highlight: 'stats' },
    { at: 'stat-overdue', highlight: 'stat-overdue' },
    { at: 'end', highlight: false },
  ]);
  assert.deepEqual(checkScript(script).diagnostics, []);
  assert.equal(existsSync(join(config.walkthroughs, 'nope', 'script.json')), false, 'a failed draft leaves no file behind');
});

test('verify --fix corrects a misspelt target against the real components, and verifies again', async () => {
  const intro = JSON.parse(readFileSync(join(app, 'tourwright', 'walkthroughs', 'intro', 'script.json'), 'utf8'));
  intro.scenes[1].beats[1].highlight = 'stat-overdew';
  const config = setup({ typo: intro });
  const { runVerify } = await import('../src/cli/verify.ts');
  const out: string[] = [];
  const { log } = console;
  console.log = (line: string) => out.push(line);
  try {
    assert.equal(await runVerify(config, 'typo', { json: false, fix: true }), 0);
  } finally {
    console.log = log;
  }
  assert.equal(JSON.parse(readFileSync(join(config.walkthroughs, 'typo', 'script.json'), 'utf8')).scenes[1].beats[1].highlight, 'stat-overdue');
  assert.match(out.join('\n'), /Fixed 1 problem in script\.json:\n {2}scenes\[1\]\.beats\[1\]\.highlight: change it to "stat-overdue"/);
  assert.match(out.join('\n'), /typo: [\d.]+ s, 7 stills, 0 errors, 0 warnings\./);
});

test('verify says which stills changed since the last run, so only those need looking at', async () => {
  const intro = JSON.parse(readFileSync(join(app, 'tourwright', 'walkthroughs', 'intro', 'script.json'), 'utf8'));
  const config = setup({ again: intro });
  const run = async () => verifyPrepared(config, await prepare(config, 'again'), quiet);
  const first = await run();
  assert.ok(first.stills.every((s) => s.change === 'new'));
  const second = await run();
  assert.ok(second.stills.every((s) => s.change === 'unchanged'), 'nothing changed, so nothing is reported as changed');
  assert.match(readFileSync(second.files.screen, 'utf8'), /No still changed since the last verify\.[^]*## overview-open \(unchanged\)/);

  // Point the second highlight somewhere else: only that beat's still changes.
  intro.scenes[1].beats[1].highlight = 'stats';
  writeFileSync(join(config.walkthroughs, 'again', 'script.json'), JSON.stringify(intro));
  const third = await run();
  assert.deepEqual(third.stills.filter((s) => s.change === 'changed').map((s) => s.label), ['stats-overdue']);
  assert.match(readFileSync(third.files.screen, 'utf8'), /Changed since the last verify: stats-overdue\. The others are pixel for pixel the same\.[^]*## stats-overdue \(changed\)/);
});

test('describe reads what is on screen at a beat from the page', async () => {
  const base = setup({});
  const config = { ...base, walkthroughs: join(app, 'tourwright', 'walkthroughs') };
  const prepared = await prepare(config, 'intro');
  const t = prepared.timeline;
  const session = await openSession(config, prepared, quiet);
  try {
    const stats = t.scenes[1]!;
    const counting = stats.beats[0]!.animate!;
    const [overdue, midCount, title] = await describeFrames(session.player, [settleFrame(t, stats, stats.beats[1]!), counting.from + Math.floor(counting.frames / 2), 0]);

    assert.equal(overdue!.scene, 'stats');
    assert.equal(overdue!.sceneIndex, 1);
    assert.equal(overdue!.sentence, 'Overdue tasks are the ones to look at first.');
    assert.equal(overdue!.caption, 'Overdue tasks are the ones to look at first.');
    assert.deepEqual(overdue!.highlight, { target: 'stat-overdue', text: 'Overdue 2 needs attention' });
    // The camera is on the stat cards, so every target is in view, and none is cut off.
    assert.deepEqual(overdue!.targets.map((x) => x.name).sort(), ['stat-overdue', 'stats', 'status-column', 'tasks']);
    const cards = overdue!.targets.find((x) => x.name === 'stats')!;
    assert.deepEqual(cards.cut, []);
    assert.equal(cards.visible, 1);
    assert.ok(cards.share > 0.05 && cards.share < 0.5, `the stat cards are a strip across the frame, not ${cards.share}`);
    assert.deepEqual(overdue!.values, [{ name: 'counts', text: '1.000', counting: false }]);
    assert.match(formatScreen(overdue!), /^[\d.]+ s · frame \d+ · scene "stats" \(scenes\[1\]\)\n {2}Saying: {8}"Overdue tasks/);

    assert.equal(midCount!.values[0]!.counting, true);
    assert.ok(Number(midCount!.values[0]!.text) > 0 && Number(midCount!.values[0]!.text) < 1);

    assert.equal(title!.title, true);
    assert.equal(title!.sceneIndex, -1);
    assert.equal(title!.highlight, null);
  } finally {
    await session.close();
  }
});

test('injected faults are each caught with a message that names the fix', async () => {
  const stages = `
import { defineStages } from 'tourwright/stage';
import '@/app/globals.css';
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { dashboard } from '../../../tourwright/fixtures';

export default defineStages({
  dashboard: {
    render: () => (
      <AppShell team={dashboard.team} active="/">
        <div data-focus="stats"><StatCards stats={dashboard.stats} /></div>
        <div data-focus="tasks"><TaskTable tasks={dashboard.tasks} /></div>
      </AppShell>
    ),
  },
  blank: { render: () => <div style={{ height: 1080, background: '#fff' }} /> },
  broken: {
    render: () => {
      throw new Error('fixtures are missing a team');
    },
  },
});
`;
  const config = setup(
    {
      faults: {
        title: 'Faults',
        scenes: [
          { id: 'typo', stage: 'dashboard', say: '[cards]These cards count tasks.', beats: [{ at: 'cards', camera: { to: 'stat' } }] },
          { id: 'offscreen', stage: 'dashboard', say: '[table]This is the task table.', beats: [{ at: 'table', camera: { to: 'tasks', zoom: 2.5 } }] },
          { id: 'empty', stage: 'blank', say: 'Nothing is here.' },
          { id: 'throws', stage: 'broken', say: 'This stage throws.' },
          { id: 'words', stage: 'dashboard', say: 'Use Export report to download it. Open "This week\'s tasks" to see them.' },
        ],
      },
    },
    stages,
  );
  const prepared = await prepare(config, 'faults');
  const session = await openSession(config, prepared, quiet);
  let report;
  try {
    report = await verifyWalkthrough('faults', prepared.timeline, session.player, prepared.outDir, session.diagnostics);
  } finally {
    await session.close();
  }
  const find = (pattern: RegExp) => report.diagnostics.find((d) => pattern.test(d.message));

  const typo = find(/"stat" is not a target/);
  assert.equal(typo?.path, 'scenes[0].beats[0].camera.to');
  assert.equal(typo?.fix, 'change it to "stats".');

  const cut = find(/target "tasks" is cut off by the frame/);
  assert.equal(cut?.path, 'scenes[1].beats[0].camera.to');
  assert.match(cut!.fix!, /zoom/);

  const blank = find(/Still empty-hold is blank/);
  assert.equal(blank?.level, 'error');

  const thrown = find(/fixtures are missing a team/);
  assert.ok(thrown, 'the thrown error is reported');
  assert.match(thrown!.fix!, /fix the error/);

  // A label the narration names must be on screen; one that is, passes.
  const words = report.diagnostics.filter((d) => /The narration names/.test(d.message));
  assert.deepEqual(
    words.map((d) => [d.path, d.message.split(',')[0]]),
    [['scenes[4].say', 'The narration names "Export report"']],
  );

  assert.equal(report.ok, false);
});

test('rendering the same script twice gives identical frames, and an MP4', { skip: !findFfmpeg(app) && 'ffmpeg is not installed' }, async () => {
  const config = setup({
    short: {
      title: 'Short',
      settings: { video: { width: 640, height: 360 } },
      scenes: [{ stage: 'dashboard', say: '[cards]These cards count your tasks.', beats: [{ at: 'cards', camera: { to: 'stats' }, highlight: 'stats' }] }],
    },
  });
  const ffmpeg = findFfmpeg(app)!;
  const hashes: string[] = [];
  for (const run of [1, 2]) {
    const prepared = await prepare(config, 'short');
    const session = await openSession(config, prepared, quiet);
    try {
      assert.deepEqual(session.diagnostics, []);
      const file = join(config.out, `short-${run}.mp4`);
      // The first run captures every frame; the second reuses a frame's screenshot when nothing on
      // screen changed. Equal hashes prove that skipping repeats is exact.
      const result = await renderVideo(prepared.timeline, session.player, { ffmpeg, file, workDir: prepared.outDir, skipIdentical: run === 2 });
      assert.ok(existsSync(file));
      assert.equal(result.frames, prepared.timeline.frames);
      hashes.push(readFileSync(result.hashFile, 'utf8'));
      // Burned captions (the default): a WebVTT file beside the video, and no subtitle track in
      // it, which players would show on top of the burned-in text.
      assert.match(readFileSync(result.captionsFile!, 'utf8'), /^WEBVTT\n\n1\n.*\nThese cards count your tasks\.\n$/);
      assert.doesNotMatch(streamsOf(ffmpeg.path, file), /Subtitle/);
    } finally {
      await session.close();
    }
  }
  assert.equal(hashes[0], hashes[1]);

  // Soft captions go inside the MP4 as a subtitle track instead.
  const soft = setup({
    soft: {
      title: 'Soft',
      settings: { video: { width: 640, height: 360 }, captions: { mode: 'soft' } },
      scenes: [{ stage: 'dashboard', say: 'These cards count your tasks.' }],
    },
  });
  const prepared = await prepare(soft, 'soft');
  const session = await openSession(soft, prepared, quiet);
  try {
    const file = join(soft.out, 'soft.mp4');
    await renderVideo(prepared.timeline, session.player, { ffmpeg, file, workDir: prepared.outDir });
    assert.match(streamsOf(ffmpeg.path, file), /Subtitle: mov_text/);
  } finally {
    await session.close();
  }
});

test('a toggle that reveals a section is measured in each layout, slides by the frame, and renders identically', { skip: !findFfmpeg(app) && 'ffmpeg is not installed' }, async () => {
  const stages = `
import { defineStage, defineStages } from 'tourwright/stage';

export default defineStages({
  toggles: defineStage({
    values: { details: { steps: [false, true] }, unused: { from: 0, to: 5 } },
    render: ({ details }) => (
      <main style={{ minHeight: 360, padding: 24, background: '#f8fafc', font: '20px sans-serif' }}>
        <div data-focus="switch" style={{ width: 80, height: 40, borderRadius: 20, background: details ? '#16a34a' : '#cbd5e1', transition: 'background-color 0.5s' }}>
          <div style={{ width: 32, height: 32, margin: 4, borderRadius: 16, background: '#fff', transform: \`translateX(\${details ? 40 : 0}px)\`, transition: 'transform 0.5s' }} />
        </div>
        <div data-focus="summary" style={{ height: 80, marginTop: 16, background: '#fff' }}>Summary</div>
        {details && <div data-focus="details" style={{ height: 80, marginTop: 16, background: '#e2e8f0' }}>Details</div>}
      </main>
    ),
  }),
});
`;
  const config = setup(
    {
      toggle: {
        title: 'Toggle',
        settings: { video: { width: 640, height: 360 } },
        scenes: [
          { id: 'early', stage: 'toggles', say: '[soon]The details are not shown yet. So nothing is there.', beats: [{ at: 'soon', camera: { to: 'details' } }] },
          {
            id: 'flip',
            stage: 'toggles',
            say: '[flip]Turn on details. [look]The details appear below the summary. [idle]Nothing else changes here.',
            beats: [
              { at: 'flip', animate: 'details' },
              { at: 'look', camera: { to: 'details' }, highlight: 'details' },
              { at: 'idle', animate: 'unused' },
            ],
          },
        ],
      },
    },
    stages,
  );
  const prepared = await prepare(config, 'toggle');
  const hashes: string[] = [];
  for (const run of [1, 2]) {
    const session = await openSession(config, prepared, quiet);
    try {
      if (run === 1) {
        const early = session.diagnostics.filter((d) => d.level === 'error');
        assert.deepEqual(
          early.map((d) => [d.path, d.message.split(':')[0]]),
          [['scenes[0].beats[0].camera.to', 'Target "details" is not on the page at this point']],
          'only the move before the flip is an error; the one after it finds the new section',
        );
        const report = await verifyWalkthrough('toggle', prepared.timeline, session.player, prepared.outDir, []);
        const unchanged = report.diagnostics.filter((d) => /changed nothing/.test(d.message));
        assert.deepEqual(unchanged.map((d) => d.path), ['scenes[1].beats[2].animate']);
        assert.ok(report.stills.some((s) => s.label === 'flip-flip-before'), 'the moment before the flip has its own still');
      }
      // As above: the second run skips repeated frames, so a transition must still be captured whole.
      const result = await renderVideo(prepared.timeline, session.player, { ffmpeg: findFfmpeg(app)!, file: join(config.out, `toggle-${run}.mp4`), workDir: prepared.outDir, skipIdentical: run === 2 });
      hashes.push(readFileSync(result.hashFile, 'utf8'));
    } finally {
      await session.close();
    }
  }
  assert.equal(hashes[0], hashes[1], 'CSS transitions are driven by the frame, so both renders match');
  // While the switch slides (0.5 s, 15 frames), consecutive frames differ: the transition plays
  // rather than jumping to its end.
  const flip = prepared.timeline.scenes[1]!.beats[0]!.animate!.from;
  const frames = hashes[0]!.split('\n').map((line) => line.split('  ')[0]);
  const sliding = new Set(frames.slice(flip, flip + 15));
  assert.ok(sliding.size > 5, `the switch should move over several frames, but only ${sliding.size} distinct frames were seen`);
});

test('inspect lists targets behind a toggle with the state they need', async () => {
  const config = setup(
    {},
    `
import { defineStage, defineStages } from 'tourwright/stage';
export default defineStages({
  toggles: defineStage({
    values: { details: { steps: [false, true] } },
    render: ({ details }) => (
      <main style={{ padding: 24 }}>
        <div data-focus="summary">Summary</div>
        {details && <div data-focus="method-card">Method</div>}
      </main>
    ),
  }),
});
`,
  );
  const { stageTargets } = await import('../src/cli/inspect.ts');
  assert.deepEqual(await stageTargets(config, 'toggles'), { always: ['summary'], sometimes: [{ target: 'method-card', when: ['details = true'] }] });
});

function streamsOf(ffmpeg: string, file: string): string {
  return spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
}
