// End to end on the example app: bundle its real components, verify with injected faults, and
// render twice to prove the frames are identical. Uses the fake voice, so no model is needed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, type ResolvedConfig } from '../src/config/config.ts';
import { prepare } from '../src/pipeline/prepare.ts';
import { openSession } from '../src/pipeline/session.ts';
import { findFfmpeg } from '../src/render/ffmpeg.ts';
import { renderVideo } from '../src/render/render.ts';
import { verifyWalkthrough } from '../src/verify/verify.ts';
import { verifyPrepared } from '../src/cli/verify.ts';

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
      const result = await renderVideo(prepared.timeline, session.player, { ffmpeg, file, workDir: prepared.outDir });
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
      const result = await renderVideo(prepared.timeline, session.player, { ffmpeg: findFfmpeg(app)!, file: join(config.out, `toggle-${run}.mp4`), workDir: prepared.outDir });
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

function streamsOf(ffmpeg: string, file: string): string {
  return spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
}
