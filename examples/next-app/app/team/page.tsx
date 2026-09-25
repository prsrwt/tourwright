import { AppShell } from '@/components/AppShell';
import { TeamList } from '@/components/TeamList';
import { getTeam } from '@/lib/data';

export default async function TeamPage() {
  const { team, members } = await getTeam();
  return (
    <AppShell team={team} active="/team">
      <TeamList members={members} />
    </AppShell>
  );
}
