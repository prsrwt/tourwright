// Files that init and new write into an app. The starter stage renders a placeholder with inline
// styles, so "tourwright make intro" works straight after init in any React app.

export function configFile(preset: string): string {
  return `import { defineConfig } from 'tourwright';

export default defineConfig({
  preset: '${preset}',
});
`;
}

export const STAGES = `// Stages render your app's real components with fixture data, one frame at a time.
//
// This starter stage renders a placeholder, so "npx tourwright make intro" works straight away.
// Replace it with your own components: import them, pass them fixture data, and wrap each part
// the narration talks about in <div data-focus="name">. Import your global CSS too, so the
// components look exactly as they do in the app. The walkthrough skill has the details.
import { defineStages } from 'tourwright/stage';
// import '../src/index.css';

const cards = ['Real components', 'Fixture data', 'No login'];

export default defineStages({
  example: {
    render: () => (
      <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: 64, display: 'grid', alignContent: 'start', gap: 40, background: '#f8fafc', color: '#0f172a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <h1 data-focus="heading" style={{ margin: 0, fontSize: 48 }}>Your app, on stage</h1>
        <section data-focus="cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 320px)', gap: 32 }}>
          {cards.map((label) => (
            <div key={label} style={{ padding: 32, borderRadius: 16, background: '#fff', border: '1px solid #e2e8f0', fontSize: 28 }}>
              {label}
            </div>
          ))}
        </section>
      </main>
    ),
    // Targets inside components you cannot wrap, as CSS selectors:
    // targets: { 'save-button': '[data-testid="save"]' },
  },
});
`;

export function introScript(schema: string): string {
  return (
    JSON.stringify(
      {
        $schema: schema,
        title: 'Welcome to Tourwright',
        subtitle: 'A first walkthrough',
        scenes: [
          {
            id: 'welcome',
            stage: 'example',
            say: '[open]This is a stage. It renders real components from your app, with fixture data. [cards]Swap these cards for your own components, and the camera will find them.',
            beats: [
              { at: 'open', camera: { to: 'all' } },
              { at: 'cards', camera: { to: 'cards', zoom: 'fit' }, highlight: 'cards' },
              { at: 'end', highlight: false },
            ],
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

export function newScript(schema: string, title: string, stage: string): string {
  return (
    JSON.stringify(
      {
        $schema: schema,
        title,
        scenes: [
          {
            id: 'overview',
            stage,
            say: '[open]Say what this screen is for, in one sentence. [detail]Then name the part the viewer should look at.',
            beats: [
              { at: 'open', camera: { to: 'all' } },
              { at: 'detail', camera: { to: 'all' } },
            ],
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}
