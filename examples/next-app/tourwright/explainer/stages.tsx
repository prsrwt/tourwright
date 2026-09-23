// Stages for the "setup" walkthrough, which explains Tourwright step by step. The terminal output
// is copied from real runs; the code views import this app's real files, so they cannot drift.
import type { ReactNode } from 'react';
import type { StageDefinition } from 'tourwright/stage';
import stagesSource from '../stages.tsx?raw';
import introScript from '../walkthroughs/intro/script.json?raw';
import { CodeView } from './CodeView';
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

export const explainerStages: Record<string, StageDefinition> = {
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
            { focus: 'imports', from: "import { AppShell }", to: "import { dashboard }" },
            { focus: 'focus-wrapper', from: '<div data-focus="stats">', to: '</div>' },
            { focus: 'selectors', from: 'targets: {', to: '},' },
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
            { focus: 'beat', from: '{ "at": "cards"' },
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
};
