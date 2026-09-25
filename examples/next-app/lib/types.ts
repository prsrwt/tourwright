export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
  id: string;
  title: string;
  assignee: string;
  status: TaskStatus;
  /** ISO date, such as "2026-03-14". */
  due: string;
}

export interface Stat {
  label: string;
  value: number;
  hint: string;
}

export interface Dashboard {
  team: string;
  stats: Stat[];
  tasks: Task[];
}

export interface Member {
  id: string;
  name: string;
  role: string;
  /** Tasks assigned this week. */
  assigned: number;
  /** How many tasks a week this person has said they can take. */
  capacity: number;
  /** Away until this ISO date, if away. */
  awayUntil?: string;
}

export interface Team {
  team: string;
  members: Member[];
}
