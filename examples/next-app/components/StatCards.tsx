import type { Stat } from '@/lib/types';

export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <section className="grid grid-cols-3 gap-6">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-500">{stat.label}</div>
          <div className="mt-2 text-3xl font-semibold">{stat.value}</div>
          <div className="mt-1 text-xs text-slate-400">{stat.hint}</div>
        </div>
      ))}
    </section>
  );
}
