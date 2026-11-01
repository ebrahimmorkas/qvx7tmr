import { useEffect, useState } from "react";

/** Minimal async-data hook: re-runs `fn` whenever `deps` change, ignores stale responses. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn()
      .then((data) => live && setState({ data, loading: false }))
      .catch((error: Error) => live && setState({ error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
