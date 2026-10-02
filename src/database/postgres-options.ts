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
 * `prepare: false` — as of drizzle-orm 0.45 and postgres 3.4 this reaches no
 * query the app runs. Every query goes through Drizzle, whose postgres-js
 * driver executes each one as `client.unsafe(query, params)`; `unsafe()`
 * marks the query itself `prepare: false` unless the caller asks otherwise
 * (Drizzle doesn't), and the per-query setting beats this client-level one.
 * Flipping it to `true` would change nothing today. It only governs
 * tagged-template queries written straight against the postgres-js client,
 * of which there are none.
 *
 * It stays `false` as the default for the first such query, or for a Drizzle
 * upgrade that starts honouring it. The older "PgBouncer can't do prepared
 * statements" advice is out of date — Neon's pooler tracks protocol-level
 * prepared statements, so turning them on would most likely work — but being
 * wrong is asymmetric: a disagreement between the driver's statement cache and
 * the pooler's shows up only under pooling, only in production, and only
 * intermittently, as a `prepared statement ... does not exist` error.
 *
 * What an unprepared query costs in postgres-js is a network round trip, not
 * a parse. With parameters, it sends Parse/Describe, waits for the server to
 * describe the parameter types, and only then sends Bind/Execute: two trips,
 * where a cached prepared statement needs one. (Without parameters it uses the
 * simple protocol, one trip either way.) Every Drizzle query already pays
 * that, whatever this option says, so if the extra trip ever shows up in a
 * measurement, the lever is how Drizzle calls the driver, not this flag.
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
