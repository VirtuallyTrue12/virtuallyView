export interface FocusState {
  activeId: string | null;
  direction: 'horizontal' | 'vertical';
  history: string[];
}

export function createFocusTracker() {
  let state: FocusState = { activeId: null, direction: 'horizontal', history: [] };

  return {
    focus(id: string) {
      state.activeId = id;
      state.history.push(id);
    },
    blur() {
      state.activeId = null;
    },
    getActive() {
      return state.activeId;
    },
    getHistory() {
      return state.history;
    }
  };
}
