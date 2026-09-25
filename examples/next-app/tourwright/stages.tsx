// Stages render the app's real components with fixtures. Wrap each section the narration visits
// in data-focus; point at elements inside a component with a selector in "targets".
import { defineStage, defineStages } from 'tourwright/stage';
import '@/app/globals.css';
import { explainerStages } from './explainer/stages';
import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { TeamList } from '@/components/TeamList';
import { dashboard, team } from './fixtures';

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
  team: defineStage({
    // "load" runs from 0 to 1, so a beat can fill each member's task count up to their real load.
    values: { load: { from: 0, to: 1, decimals: 3 } },
    render: ({ load }) => (
      <AppShell team={team.team} active="/team">
        <div data-focus="list">
          <TeamList members={team.members.map((member) => ({ ...member, assigned: Math.round(member.assigned * load) }))} />
        </div>
      </AppShell>
    ),
    targets: {
      'member-amara': '[data-testid="member-amara"]',
      'load-amara': '[data-testid="load-amara"]',
      'member-jonas': '[data-testid="member-jonas"]',
      'away-jonas': '[data-testid="away-jonas"]',
    },
  }),
  // Stages for the "setup" walkthrough, which explains Tourwright itself.
  ...explainerStages,
});
