// Fixture data for the stages, typed against the app's real interfaces. Every name is fictional.
import type { Dashboard, Team } from '@/lib/types';

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

export const team: Team = {
  team: 'Riverside Design',
  members: [
    { id: 'amara', name: 'Amara Osei', role: 'Coordinator', assigned: 5, capacity: 4 },
    { id: 'tom', name: 'Tom Hughes', role: 'Venues', assigned: 2, capacity: 3 },
    { id: 'priya', name: 'Priya Nair', role: 'Volunteers', assigned: 3, capacity: 5 },
    { id: 'jonas', name: 'Jonas Berg', role: 'Print and design', assigned: 0, capacity: 3, awayUntil: '2026-03-23' },
  ],
};
