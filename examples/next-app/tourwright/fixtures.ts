// Fixture data for the stages, typed against the app's real interfaces. Every name is fictional.
import type { Dashboard } from '@/lib/types';

export const dashboard: Dashboard = {
  team: 'Riverside Design',
  stats: [
    { label: 'Open tasks', value: 12, hint: '3 due this week' },
    { label: 'Completed', value: 48, hint: 'since 1 March' },
    { label: 'Overdue', value: 2, hint: 'needs attention' },
  ],
  tasks: [
    { id: 't1', title: 'Draft the spring newsletter', assignee: 'Amara Osei', status: 'in-progress', due: '2026-03-18' },
    { id: 't2', title: 'Book the community hall', assignee: 'Tom Hughes', status: 'todo', due: '2026-03-20' },
    { id: 't3', title: 'Update the volunteer rota', assignee: 'Priya Nair', status: 'done', due: '2026-03-12' },
    { id: 't4', title: 'Order printed flyers', assignee: 'Amara Osei', status: 'todo', due: '2026-03-25' },
  ],
};
