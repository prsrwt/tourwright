// Stages render the app's real components with fixtures. Wrap each section the narration visits
// in data-focus; point at elements inside a component with a selector in "targets".
import { defineStage, defineStages } from 'tourwright/stage';
import '@/app/globals.css';
import { explainerStages } from './explainer/stages';
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { dashboard } from './fixtures';

export default defineStages({
  dashboard: defineStage({
    // "counts" runs from 0 to 1, so a beat can count every stat card up to its real value.
    values: { counts: { from: 0, to: 1, decimals: 3 } },
    render: ({ counts }) => (
      <AppShell team={dashboard.team} active="/">
        <div data-focus="stats">
          <StatCards stats={dashboard.stats.map((stat) => ({ ...stat, value: Math.round(stat.value * counts) }))} />
        </div>
        <div data-focus="tasks">
          <TaskTable tasks={dashboard.tasks} />
        </div>
      </AppShell>
    ),
    targets: {
      'stat-overdue': '[data-testid="stat-overdue"]',
      'status-column': '[data-testid^="status-"]',
    },
  }),
  // Stages for the "setup" walkthrough, which explains Tourwright itself.
  ...explainerStages,
});
