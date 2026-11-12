import type { MiddlewareHandler } from 'hono';
import { Problem, type AppEnv, type Env } from './common';
import { record, reserve } from './cost';

type Counts = { dbRead: number; dbWrite: number };
function add(counts: Counts, result: D1Result) {
  counts.dbRead += result.meta.rows_read ?? 0;
  counts.dbWrite += result.meta.rows_written ?? 0;
}

function measured(db: D1Database, counts: Counts): D1Database {
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function wrap(raw: D1PreparedStatement): D1PreparedStatement {
    const tracked = new Proxy(raw, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'first') return async (key?: string) => {
          const result = await target.all<Record<string, unknown>>();
          add(counts, result);
          const row = result.results[0];
          return key ? row?.[key] ?? null : row ?? null;
        };
        if (property === 'all' || property === 'run') return async () => {
          const result = await target[property]();
          add(counts, result);
          return result;
        };
        const member = Reflect.get(target, property, target);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
    statements.set(tracked, raw);
    return tracked;
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') return async (items: D1PreparedStatement[]) => {
        const result = await target.batch(items.map(item => statements.get(item) ?? item));
        for (const row of result) add(counts, row);
        return result;
      };
      const member = Reflect.get(target, property, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function protectedPath(path: string) {
  return /^(?:\/api\/(?:admin\/|library(?:\/|$)|session(?:\/|$)|support(?:\/|$)|webhooks\/|github\/(?:login|callback)(?:\/|$))|\/api\/purchases\/[\w-]+(?:\/(?:capture|refresh|cancel))?$|\/api\/operator\/(?:reconcile|refund\/))/.test(path);
}
export const meterRequests: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.env.DB;
  const essential = protectedPath(c.req.path);
  const counts: Counts = { dbRead: 0, dbWrite: 0 };
  const env: Env = { ...c.env, COST_DB: raw, DB: measured(raw, counts) };
  c.env = env;
  let tracked = false;
  try {
    if (essential) {
      // Operational bookkeeping cannot block provider readback, refunds, or owned library access.
      tracked = true;
    } else {
      let granted: boolean;
      try { granted = await reserve(env, { api: 1 }); }
      catch { throw new Problem(503, 'Capacity checks are unavailable. Please retry shortly.'); }
      if (!granted) throw new Problem(503, 'New requests are paused while capacity recovers. Your library and receipts remain available.');
      tracked = true;
    }
    await next();
  } finally {
    // The meter uses the raw binding to avoid counting itself recursively. Add a fixed overhead per admitted request.
    const denied = c.res.status === 401 || c.res.status === 403;
    if (tracked && (!essential || (!denied && (c.get('actor') || c.req.method !== 'GET')))) {
      await record(env, { ...(essential ? { api: 1 } : {}), dbRead: counts.dbRead + 64, dbWrite: counts.dbWrite + 20 }).catch(() => undefined);
    }
  }
};
