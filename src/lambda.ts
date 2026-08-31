import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import awsLambdaFastify, { PromiseHandler } from '@fastify/aws-lambda';
import { configureApp } from './bootstrap';
import { loadConfigFromParameterStore } from './config/parameter-store';

// The package declares both a promise-returning and a callback-style handler
// as overloads, and ReturnType picks the last one. Naming the promise form is
// what keeps the handler awaitable.
type LambdaHandler = PromiseHandler;

/**
 * Entry point when this app runs as a Lambda function — alongside main.ts
 * rather than instead of it, since `npm run start:dev` and the e2e suite
 * still boot a real server.
 *
 * The promise is what is cached at module scope, not the resolved handler,
 * and that distinction is the point. Lambda keeps an execution environment
 * alive between invocations, so everything built out here is built once per
 * environment instead of once per request: the Nest container, the Fastify
 * instance, the database pool. Caching the *promise* means two invocations
 * arriving before the first build finishes wait on that build rather than
 * racing to start a second one.
 */
let bootstrapping: Promise<LambdaHandler> | null = null;

async function build(): Promise<LambdaHandler> {
  await loadConfigFromParameterStore();

  // Imported here rather than at the top of the file, and that is the entire
  // reason the line above is worth anything.
  //
  // A static import is evaluated when *this* module is loaded, before any
  // function in it runs. AuthModule throws at import time when JWT_SECRET is
  // missing, and app.module.ts also decides where rate-limit counters live
  // and what they are keyed on while its decorator is evaluated. With a
  // static import, all of that happens against an empty environment and the
  // parameters arrive afterwards, to a process that has already concluded it
  // has no configuration.
  //
  // That is not hypothetical: it is how the first deploy of this function
  // failed — "JWT_SECRET environment variable is not defined", thrown from
  // app.module.js requiring auth.module.js, while the loader that would have
  // provided it had not been reached yet.
  // The .js suffix is required by moduleResolution: nodenext, which treats a
  // dynamic import as ESM even in a CommonJS file and resolves it against the
  // emitted filename rather than the source one.
  const { AppModule } = (await import('./app.module.js')) as {
    AppModule: new () => unknown;
  };

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Still required, and for the same reason as in main.ts, but the proxy
    // being trusted is a different one: the visitor's address arrives in
    // X-Forwarded-For from the function URL rather than on the socket.
    //
    // This is the one thing here that cannot be confirmed without a real
    // deployment, and it is load-bearing — every per-IP rate limit is only as
    // good as the address Fastify resolves. With a CDN in front of the
    // function URL that header carries more than one hop, so what has to be
    // checked against the deployed stack is that `request.ip` is the
    // visitor's and not an edge node's. A limit keyed on an edge node is one
    // global bucket wearing a per-IP disguise.
    new FastifyAdapter({ trustProxy: true }),
  );

  await configureApp(app);

  // init(), not listen(): there is no port to bind to. It still runs the same
  // module initialisation lifecycle a server start would, so OnModuleInit
  // hooks — DatabaseService opening its pool among them — do run.
  await app.init();

  const instance = app.getHttpAdapter().getInstance();
  await instance.ready();

  // The adapter already translates the function URL's payload v2 shape in
  // both directions: incoming `event.cookies` becomes a `cookie` header, and
  // outgoing Set-Cookie headers become the `cookies` array the response
  // format requires. That matters more than it looks — a session cookie lost
  // on the way out is indistinguishable from a login that succeeded and then
  // did nothing.
  return awsLambdaFastify(instance);
}

export const handler: LambdaHandler = async (event, context) => {
  bootstrapping ??= build();
  const ready = await bootstrapping;

  return ready(event, context);
};
