// Drop-in replacements for convex/react's useQuery / useMutation / useConvex,
// backed by Supabase (see ./store.js and ./api.js). Same call shapes:
//
//   const tasks = useQuery(api.tasks.getTasksLight, { workspace });   // undefined while loading
//   const save  = useMutation(api.tasks.updateTaskStatus);            // returns a Promise
//   useQuery(def, "skip")                                             // don't run
//   useMutation(def).withOptimisticUpdate((localStore, args) => …)
//   prefetchQuery(api.tasks.getTaskById, { taskId })                  // warm the cache, no hook
import { useCallback, useMemo, useSyncExternalStore } from "react";
import * as store from "./store";

export function useQuery(def, args) {
  const skip = !def || args === "skip";
  const key = skip ? null : store.keyOf(def, args);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback((cb) => (skip ? () => {} : store.subscribe(def, args, cb)), [key]);
  const getSnapshot = useCallback(() => (skip ? undefined : store.peek(key)), [key, skip]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function makeMutation(def, optimistic) {
  const run = async (args) => {
    if (optimistic) store.applyOptimistic(optimistic, args);
    return store.runMutation(def, args);
  };
  run.withOptimisticUpdate = (update) => makeMutation(def, update);
  return run;
}

export function useMutation(def) {
  return useMemo(() => makeMutation(def), [def]);
}

/** Load a query into the cache ahead of time (no re-renders) — see store.prefetch. */
export const prefetchQuery = (def, args) => store.prefetch(def, args);

/** Imperative access (Caddy's tools): fresh reads and mutations. */
export function useConvex() {
  return useMemo(() => ({
    query: (def, args) => def.run(args ?? {}),
    mutation: (def, args) => store.runMutation(def, args),
  }), []);
}
