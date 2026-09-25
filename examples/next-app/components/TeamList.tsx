import type { Member } from '@/lib/types';

// A fixed locale and time zone, so the same date renders the same way on every machine.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Everyone on the team, with this week's tasks against what they can take. */
export function TeamList({ members }: { members: Member[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-6 py-4 font-medium">Who is doing what</h2>
      <ul>
        {members.map((member) => {
          const over = member.assigned > member.capacity;
          const share = Math.min(1, member.assigned / member.capacity);
          return (
            <li key={member.id} data-testid={`member-${member.id}`} className="flex items-center gap-6 border-t border-slate-100 px-6 py-4 first:border-t-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
                {member.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')}
              </div>
              <div className="w-48 shrink-0">
                <div className="font-medium">{member.name}</div>
                <div className="text-sm text-slate-500">{member.role}</div>
              </div>
              <div className="flex-1" data-testid={`load-${member.id}`}>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>
                    {member.assigned} of {member.capacity} tasks
                  </span>
                  {over && <span className="font-medium text-rose-700">Over capacity</span>}
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${over ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${share * 100}%` }} />
                </div>
              </div>
              <div className="w-32 shrink-0 text-right text-sm">
                {member.awayUntil ? (
                  <span data-testid={`away-${member.id}`} className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
                    Away until {dateFormat.format(new Date(member.awayUntil))}
                  </span>
                ) : (
                  <span className="text-slate-400">Available</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
