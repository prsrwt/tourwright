import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectStage } from '../src/analyze/inspect.ts';
import { scaffoldStage } from '../src/analyze/scaffold.ts';
import { namedLabels } from '../src/verify/words.ts';

const app = fileURLToPath(new URL('../examples/next-app/', import.meta.url));
const stages = join(app, 'tourwright', 'stages.tsx');
const scratch = join(app, 'out', '.test', `analyze-${process.pid}`);
after(() => rmSync(scratch, { recursive: true, force: true }));

test('labels count as named only in quotes or after an action verb', () => {
  assert.deepEqual(namedLabels('Use Prepare claim to create your submission.'), ['Prepare claim']);
  assert.deepEqual(namedLabels('Select the Show details button, then check the total.'), ['Show details']);
  assert.deepEqual(namedLabels('Open "Claim history" to see past claims.'), ['Claim history']);
  assert.deepEqual(namedLabels('HMRC pays GASDS on small donations.'), [], 'capitalised words alone are not labels');
  assert.deepEqual(namedLabels('Use it when you are ready.'), [], 'a lowercase word after the verb is not a label');
});

test('inspect lists the components a stage renders, with prop types, what it passes, and what could move', () => {
  const inspection = inspectStage(app, stages, 'dashboard');
  assert.deepEqual(
    inspection.components.map((c) => [c.name, c.from]),
    [
      ['AppShell', '@/components/AppShell'],
      ['StatCards', '@/components/StatCards'],
      ['TaskTable', '@/components/TaskTable'],
    ],
  );
  const shell = inspection.components[0]!;
  assert.deepEqual(
    shell.props.map((p) => [p.name, p.type, p.passed]),
    [
      ['team', 'string', 'dashboard.team'],
      ['active', 'string', '"/"'],
    ],
  );
  const stats = inspection.components[1]!.props[0]!;
  assert.equal(stats.motion?.kind, 'scale');
  assert.deepEqual(stats.motion?.kind === 'scale' && stats.motion.fields, ['value']);
  assert.deepEqual(inspection.values, ['counts: { from: 0, to: 1, decimals: 3 }']);
  // Stages spread in from another file are found too.
  assert.equal(inspectStage(app, stages, 'terminal').components[1]!.name, 'Terminal');
  assert.throws(() => inspectStage(app, stages, 'dashbord'), /Stages: "dashboard"/);
});

test('scaffold drafts a stage from a page: its sections in order, wrappers kept, typed placeholders', () => {
  // A stages file somewhere other than the default: the draft goes beside it, and names it.
  const result = scaffoldStage(app, join(app, 'app', 'page.tsx'), 'dashboard-draft', join(scratch, 'trial', 'stages.tsx'));
  assert.equal(result.file, join(scratch, 'trial', 'scaffold', 'dashboard-draft.tsx'));
  assert.deepEqual(result.components, ['AppShell', 'StatCards', 'TaskTable']);
  assert.deepEqual(result.problems, [], 'the draft type-checks as written');
  const draft = readFileSync(result.file, 'utf8');
  assert.match(draft, /import \{ StatCards \} from '@\/components\/StatCards';/);
  assert.match(draft, /\/\/ this stage to out\/\.test\/analyze-\d+\/trial\/stages\.tsx\./);
  assert.match(draft, /export const appShellProps: Omit<ComponentProps<typeof AppShell>, 'children'> = \{/);
  assert.match(draft, /stats: \[\], {2}\/\/ What the page passes: dashboard\.stats/);
  // The shell wraps the sections; each section is a target.
  assert.match(draft, /<AppShell \{\.\.\.appShellProps\}>\n\s+<div data-focus="stat-cards">\n\s+<StatCards \{\.\.\.statCardsProps\} \/>/);
  assert.match(draft, /StatCards\.stats: a list with number fields "value"/);
});
