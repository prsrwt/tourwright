// Stages render the app's real components with fixtures. Wrap each section the narration visits
// in data-focus; point at elements inside a component with a selector in "targets".
import { defineStages } from 'tourwright/stage';
import '@/app/globals.css';
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { dashboard } from './fixtures';

export default defineStages({
  dashboard: {
    render: () => (
      <AppShell team={dashboard.team} active="/">
        <div data-focus="stats">
          <StatCards stats={dashboard.stats} />
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
  },
});
