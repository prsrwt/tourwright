import { AppShell } from '@/components/AppShell';
import { StatCards } from '@/components/StatCards';
import { TaskTable } from '@/components/TaskTable';
import { getDashboard } from '@/lib/data';

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  return (
    <AppShell team={dashboard.team} active="/">
      <StatCards stats={dashboard.stats} />
      <TaskTable tasks={dashboard.tasks} />
    </AppShell>
  );
}
