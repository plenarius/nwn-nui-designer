/**
 * Undo and redo over immutable states. Each edit pushes the state it replaces; edits that share a coalescing key
 * within a short time (typing in one property field) make one step.
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  /** The key and time of the last push, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 300;
export const COALESCE_MS = 1000;

export function startHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

/**
 * Makes next the present. With a key equal to the last push's, within COALESCE_MS, the step merges into the last one
 * (one undo takes back all of it).
 */
export function push<T>(h: HistoryState<T>, next: T, key: string | null = null, now = Date.now()): HistoryState<T> {
  if (next === h.present) return h;
  const merge = key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

/**
 * A live edit (a size being dragged): base with next shown as the present, but not pushed. Committing is
 * push(base, final), so the whole drag is one step; cancelling is going back to base.
 */
export function preview<T>(base: HistoryState<T>, next: T): HistoryState<T> {
  return { ...base, present: next };
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next!, future: rest, lastKey: null, lastAt: 0 };
}

export const canUndo = <T>(h: HistoryState<T>) => h.past.length > 0;
export const canRedo = <T>(h: HistoryState<T>) => h.future.length > 0;
