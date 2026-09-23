import type { Task, TaskStatus } from '@/lib/types';

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: 'To do', className: 'bg-slate-100 text-slate-700' },
  'in-progress': { label: 'In progress', className: 'bg-amber-100 text-amber-800' },
  done: { label: 'Done', className: 'bg-emerald-100 text-emerald-800' },
};

// A fixed locale and time zone, so the same date renders the same way on every machine.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function TaskTable({ tasks }: { tasks: Task[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-6 py-4 font-medium">This week&apos;s tasks</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="px-6 py-3 font-normal">Task</th>
            <th className="px-6 py-3 font-normal">Assignee</th>
            <th className="px-6 py-3 font-normal">Status</th>
            <th className="px-6 py-3 font-normal">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-slate-100">
              <td className="px-6 py-3">{task.title}</td>
              <td className="px-6 py-3 text-slate-600">{task.assignee}</td>
              <td className="px-6 py-3">
                <span data-testid={`status-${task.id}`} className={`rounded-full px-2 py-1 text-xs ${STATUS[task.status].className}`}>
                  {STATUS[task.status].label}
                </span>
              </td>
              <td className="px-6 py-3 text-slate-600">{dateFormat.format(new Date(task.due))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
