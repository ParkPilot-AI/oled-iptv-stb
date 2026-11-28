// Background sync status (playlist refresh, TV guide, channel logos) for the
// small "Updating…" pill. Electron-free; main forwards changes to the renderer.
export function createSyncTracker(send) {
  const tasks = new Map(); // id → label
  let seq = 0;
  const emit = () => send('sync:status', { tasks: [...tasks.values()] });
  /** Run a promise as a labelled background task; resolves/rejects like it. */
  function track(label, promise) {
    const id = ++seq;
    tasks.set(id, label);
    emit();
    return Promise.resolve(promise).finally(() => {
      tasks.delete(id);
      emit();
    });
  }
  return { track, list: () => [...tasks.values()] };
}
