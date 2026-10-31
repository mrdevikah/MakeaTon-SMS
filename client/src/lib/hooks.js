import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Fetch a resource and expose { data, error, loading, reload }. Re-fetches when `path` changes. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    api(path).then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (error) => id === seq.current && setState({ data: null, error, loading: false }),
    );
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
