import { useEffect, useState } from 'react';

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(value?.error || 'The service is unavailable. Please try again.');
  return value as T;
}
export const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
export function useRemote<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setData(null); setError('');
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, 'GET', undefined, controller.signal)
      .then(setData).catch(err => { if (!controller.signal.aborted) setError(message(err)); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, refresh: () => setRevision(n => n + 1) };
}
