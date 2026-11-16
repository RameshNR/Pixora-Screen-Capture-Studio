import type { EditorDoc } from '../types';

export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  doc: EditorDoc;
  /** Human-readable description shown in the History panel ("Add arrow", "Crop"…). */
  label: string;
  at: number;
}

export interface HistoryState {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
  /** The document as first loaded — "Reset" returns here (and is itself undoable). */
  original: EditorDoc;
  /** Key of the last coalescable commit (e.g. dragging a slider produces one undo step). */
  lastKey: string | null;
}

export type HistoryAction =
  | { type: 'commit'; doc: EditorDoc; label: string; coalesceKey?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'jump'; index: number }
  | { type: 'load'; doc: EditorDoc };

export function createHistory(doc: EditorDoc): HistoryState {
  return { past: [], present: { doc, label: 'Original capture', at: Date.now() }, future: [], original: doc, lastKey: null };
}

/** All steps in order (past → present → future); `index` of present is past.length. */
export function timeline(s: HistoryState): HistoryEntry[] {
  return [...s.past, s.present, ...s.future];
}

/** Snapshot-based undo/redo. Snapshots share unchanged annotation objects (structural sharing). */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'load':
      return createHistory(action.doc);
    case 'commit': {
      if (action.doc === state.present.doc) return state;
      const entry = { doc: action.doc, label: action.label, at: Date.now() };
      if (action.coalesceKey && action.coalesceKey === state.lastKey) {
        return { ...state, present: entry, future: [] };
      }
      return {
        ...state,
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: entry,
        future: [],
        lastKey: action.coalesceKey ?? null,
      };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future], lastKey: null };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, past: [...state.past, state.present], present: next, future: state.future.slice(1), lastKey: null };
    }
    case 'jump': {
      const all = timeline(state);
      const target = all[action.index];
      if (!target || action.index === state.past.length) return state;
      return { ...state, past: all.slice(0, action.index), present: target, future: all.slice(action.index + 1), lastKey: null };
    }
    case 'reset':
      if (state.present.doc === state.original) return state;
      return {
        ...state,
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: { doc: state.original, label: 'Reset to original', at: Date.now() },
        future: [],
        lastKey: null,
      };
    default:
      return state;
  }
}

export const canUndo = (s: HistoryState) => s.past.length > 0;
export const canRedo = (s: HistoryState) => s.future.length > 0;
