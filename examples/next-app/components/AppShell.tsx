import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ team, active, children }: { team: string; active: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white p-6">
        <div className="mb-8 text-lg font-semibold text-indigo-700">Larkspur</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm ${item.href === active ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
          <h1 className="text-xl font-semibold">{team}</h1>
          <span className="text-sm text-slate-500">Week 11</span>
        </header>
        <main className="flex flex-col gap-8 p-8">{children}</main>
      </div>
    </div>
  );
}
