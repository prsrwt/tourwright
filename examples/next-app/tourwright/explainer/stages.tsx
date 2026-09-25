// Stages for the "setup" and "tourwright" walkthroughs, which explain Tourwright. The terminal output
// is copied from real runs; the code views import this app's real files, so they cannot drift; and
// Muse is Muse's own components, given sample state.
import type { ReactNode } from 'react';
import type { StageDefinition } from 'tourwright/stage';
import stagesSource from '../stages.tsx?raw';
import introScript from '../walkthroughs/intro/script.json?raw';
import { AgentChat } from './AgentChat';
import { CodeView } from './CodeView';
import { MUSE_STEPS, MuseStage } from './MuseStage';
import { Terminal, type TerminalBlock } from './Terminal';

const contactSheet = new URL('./contact-sheet.png', import.meta.url).href;

const setup: TerminalBlock[] = [
  {
    focus: 'install',
    command: 'npm install -D tourwright',
    output: ['added 93 packages, and audited 97 packages'],
  },
  {
    focus: 'init',
    command: 'npx tourwright init',
    output: [
      'Set up Tourwright for a Next.js app.',
      '  created  tourwright.config.mts',
      '  created  tourwright/stages.tsx',
      '  created  tourwright/walkthroughs/intro/script.json',
      '  created  .claude/skills/walkthrough/',
      '  created  .gitignore (added tourwright/out/)',
    ],
    marks: [['init-files', 1, 5]],
  },
  {
    focus: 'browser',
    command: 'npx playwright install --only-shell chromium',
    output: ['Chrome Headless Shell 153.0.8010.12 downloaded to ms-playwright/chromium_headless_shell-1243'],
  },
  {
    focus: 'doctor',
    command: 'npx tourwright doctor',
    output: [
      'ok   node     24.19.0 (needs 22.18 or later)',
      'ok   config   tourwright.config.mts (preset next, voice kokoro)',
      'ok   stages   tourwright/stages.tsx',
      'ok   ffmpeg   6.1.1 from ffmpeg-static',
      'ok   browser  headless Chromium 153.0.8010.12',
      'ok   voice    Kokoro model cached',
    ],
  },
];

const make: TerminalBlock[] = [
  {
    focus: 'make',
    command: 'npx tourwright make intro',
    output: [
      'Voiced 6 sentences.',
      'Verifying intro...',
      'intro: 25.0 s, 6 stills, 0 errors, 0 warnings.',
      'Rendering 749 frames (25.0 s at 30 fps)...',
      'Rendered 749 frames in 41.2 s.',
      'Wrote tourwright/out/intro.mp4 (25.0 s).',
    ],
    marks: [['make-result', 5, 5]],
  },
];

// make as it runs now: it opens Muse by itself at the end.
const makeAndReview: TerminalBlock[] = [
  {
    focus: 'make',
    command: 'npx tourwright make intro',
    output: [
      'Voiced 7 sentences.',
      'Verifying intro...',
      'intro: 25.0 s, 7 stills, 0 errors, 0 warnings.',
      'Rendering 749 frames (25.0 s at 30 fps)...',
      'Rendered 749 frames in 15.3 s (615 repeated the frame before, so were not captured again).',
      'Wrote tourwright/out/intro.mp4 (25.0 s).',
      '',
      'Opened Muse to review it: http://127.0.0.1:43127/__tourwright/studio',
      'Watch it, leave notes, and approve it there.',
    ],
    marks: [
      ['make-check', 0, 2],
      ['make-render', 3, 5],
      ['make-muse', 7, 8],
    ],
  },
];

// What the agent's wait prints when the notes arrive, and its replies, in the real formats.
const agentLoop: TerminalBlock[] = [
  {
    focus: 'wait',
    command: 'npx tourwright wait intro',
    output: [
      'Review: changes requested on 2026-09-25 10:00 UTC.',
      'The user sent 2 notes for you to handle:',
      '[a1] at 13.500 s (frame 405), in scene "stats" (scenes[1])',
      '  on target "stat-overdue"',
      '  Zoom in closer on the overdue card.',
      '[b2] at 21.500 s (frame 645), in scene "tasks" (scenes[2])',
      '  the text there: "Status", "In progress", "To do", "Done", "To do"',
      '  Give the status column its own narration box.',
    ],
    marks: [['wait-notes', 2, 7]],
  },
  {
    focus: 'reply',
    command: 'npx tourwright reply intro a1 --fixed "The camera now zooms in to twice the size."',
    output: ['Replied to note a1 and marked it fixed. The user approves it in Muse, or sends it back.'],
  },
];

const verify: TerminalBlock[] = [
  {
    focus: 'verify-command',
    command: 'npx tourwright verify intro',
    output: ['intro: 25.0 s, 6 stills, 0 errors, 0 warnings.', '  Contact sheet  tourwright/out/intro/contact-sheet.png'],
  },
];

function Page({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col gap-12 bg-slate-100 px-24 py-20 text-slate-900">
      <header data-focus="heading">
        <div className="text-2xl font-medium uppercase tracking-widest text-indigo-600">{step}</div>
        <h1 className="mt-3 text-6xl font-semibold">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export const explainerStages: Record<string, StageDefinition<any>> = {
  terminal: {
    render: () => (
      <Page step="Steps 1 to 3" title="Install and set up">
        <Terminal blocks={setup} />
      </Page>
    ),
  },
  'stages-file': {
    render: () => (
      <Page step="Step 4" title="Stage your real components">
        <CodeView
          file="tourwright/stages.tsx"
          source={stagesSource}
          window={{ from: 'import { AppShell }', until: 'Stages for the "setup" walkthrough' }}
          marks={[
            { focus: 'imports', from: "import { AppShell }", to: "import { dashboard" },
            { focus: 'focus-wrapper', from: '<div data-focus="stats">', to: '</div>' },
            { focus: 'selectors', from: 'targets: {', to: '},' },
            { focus: 'values', from: 'values: { counts' },
          ]}
        />
      </Page>
    ),
  },
  'script-file': {
    render: () => (
      <Page step="Step 5" title="Write the script">
        <CodeView
          file="tourwright/walkthroughs/intro/script.json"
          source={introScript}
          marks={[
            { focus: 'say', from: '"say": "[cards]' },
            { focus: 'beat', from: '"at": "cards"', to: '"animate": "counts"' },
          ]}
        />
      </Page>
    ),
  },
  verify: {
    render: () => (
      <Page step="Step 6" title="Verify before you render">
        <Terminal blocks={verify} />
        <img data-focus="contact-sheet" src={contactSheet} alt="Contact sheet of every still" className="w-full rounded-2xl shadow-2xl" />
      </Page>
    ),
  },
  make: {
    render: () => (
      <Page step="Step 7" title="Make the video">
        <Terminal blocks={make} />
      </Page>
    ),
  },
  agent: {
    render: () => (
      <Page step="Or ask for it" title="Your agent does the work">
        <AgentChat
          request="Make a narrated walkthrough video of the Team screen, for someone joining the team."
          steps={[
            { text: 'Read the walkthrough skill' },
            { text: 'Staged the real Team page', detail: 'with sample data' },
            { text: 'Wrote the script', detail: '5 scenes, 53 s' },
            { text: 'npx tourwright verify team', detail: '0 errors, 0 warnings' },
            { text: 'npx tourwright make team', detail: 'Muse is open for your review' },
          ]}
        />
      </Page>
    ),
  },
  'make-review': {
    render: () => (
      <Page step="One command" title="Make it">
        <Terminal blocks={makeAndReview} />
      </Page>
    ),
  },
  'agent-loop': {
    render: () => (
      <Page step="Meanwhile, in the agent's terminal" title="It hears your notes">
        <Terminal blocks={agentLoop} />
      </Page>
    ),
  },
  muse: {
    // One step per moment of a review, in order; the playhead runs through the video; the render counts up.
    values: { muse: { steps: MUSE_STEPS }, playhead: { from: 75, to: 405 }, rendered: { from: 0, to: 100 } },
    render: ({ muse, playhead, rendered }) => <MuseStage step={muse} playhead={playhead} rendered={rendered} />,
    targets: {
      review: '[data-review]',
      approve: '[data-action="approve"]',
      scrubber: '[data-scrubber]',
      'box-track': '[data-box-track]',
      'new-box': '[data-segment="team-name"]',
      'add-box': '[data-action="add-box"]',
      playback: 'select[aria-label="Playback speed"], button[aria-label="Loop this scene"]',
      'write-note': 'button[title^="Note at this moment"]',
      composer: 'label[for="new-note"]',
      'note-a1': '[data-note="a1"]',
      'note-b2': '[data-note="b2"]',
      'send-bar': '[data-send-bar]',
      dialog: '[data-render-dialog]',
      'render-status': '[data-render-status]',
    },
  } satisfies StageDefinition<{ muse: { steps: typeof MUSE_STEPS }; playhead: { from: number; to: number }; rendered: { from: number; to: number } }>,
};
