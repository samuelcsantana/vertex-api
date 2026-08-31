import type { Options } from 'postgres';

/**
 * Client options shared by every postgres-js connection this app opens.
 *
 * They exist because the deployed `DATABASE_URL` points at Neon's *pooled*
 * endpoint (the hostname with the `-pooler` suffix), which is PgBouncer in
 * transaction mode: the server-side connection is handed back to the pool at
 * the end of every transaction rather than being held for the session. The
 * app is compatible with that today — nothing here uses `SET`,
 * `LISTEN`/`NOTIFY`, session advisory locks or temporary tables, and the three
 * places that open a transaction each do all their work inside it — so these
 * three options are what the switch actually costs.
 *
 * `prepare: false` — the older "PgBouncer can't do prepared statements at all"
 * advice is out of date: Neon's pooler tracks protocol-level prepared
 * statements, so leaving them on would most likely work. They are off because
 * being wrong is asymmetric. A disagreement between the driver's statement
 * cache and the pooler's shows up only under pooling, only in production, and
 * only intermittently, as `prepared statement "s1" already exists`. What
 * turning them off costs is one parse per query — noise next to a single
 * round trip to a database on another continent. Turn it back on when there is
 * a measurement saying it matters, not on principle.
 *
 * `max: 5` — behind a pooler the client-side pool is no longer *the* pool.
 * PgBouncer is, and it accepts far more clients than one Postgres ever could.
 * This number only has to cover the queries a single process has in flight,
 * and keeping it small is what stops processes from multiplying into
 * connections: every additional instance opens its own `max`, so the number
 * that matters is `instances × max`, not `max`.
 *
 * `idle_timeout: 20` — seconds. Connections this process has stopped using are
 * returned instead of held open, so an idle instance doesn't sit on pool slots
 * a busy one could be using. Without it postgres-js keeps every connection it
 * ever opened for the life of the process.
 */
export const postgresClientOptions: Options<Record<string, never>> = {
  prepare: false,
  max: 5,
  idle_timeout: 20,
};
