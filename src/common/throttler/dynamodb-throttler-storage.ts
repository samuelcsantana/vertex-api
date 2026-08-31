import { Injectable, Logger } from '@nestjs/common';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ThrottlerStorage } from '@nestjs/throttler';
import {
  advanceThrottleWindow,
  ThrottleDecision,
  ThrottleWindow,
} from './throttle-window';

// One extra attempt covers the ordinary collision: two requests for the same
// key read the same version and one of them loses the conditional write. A
// third is there for the rarer chain of two. Beyond that the key is hot enough
// that spending more round trips per request costs more than the limit it is
// protecting.
const MAX_ATTEMPTS = 3;

// Items outlive their window by this much before DynamoDB is allowed to
// collect them. TTL deletion is not prompt — AWS documents it as "typically
// within two days" and says expired items still show up in reads until then —
// so nothing here may depend on it for correctness. `windowEndsAt` is the
// clock; this attribute only keeps the table from growing forever.
const GARBAGE_COLLECTION_GRACE_SECONDS = 3600;

/**
 * A ThrottlerStorage backed by one DynamoDB item per throttler key.
 *
 * The default storage that ships with @nestjs/throttler keeps its counters in
 * the process, which makes the configured limit a per-instance limit: with N
 * instances an attacker gets N times the budget, and which instance answers is
 * up to a load balancer. Login, registration and the OTP routes are where
 * that matters — they are brute-force and email-spam surfaces, and their
 * limits are tightened on purpose.
 *
 * State is read and written with optimistic concurrency on a `version`
 * attribute rather than with DynamoDB's atomic ADD. ADD would make the
 * increment a single round trip, but the rule being enforced is not "add one":
 * it is a small state machine over window expiry and blocking (see
 * advanceThrottleWindow), and expressing that in update expressions would
 * scatter it across strings that no test can reach. Read, decide in code,
 * write if nothing changed underneath — and retry when it did.
 */
@Injectable()
export class DynamoDbThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(DynamoDbThrottlerStorage.name);

  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottleDecision> {
    const itemKey = `${throttlerName}:${key}`;

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await this.read(itemKey);
        const now = Date.now();
        const { next, record } = advanceThrottleWindow(
          current?.window ?? null,
          now,
          ttl,
          limit,
          blockDuration,
        );

        try {
          await this.write(itemKey, next, current?.version ?? null);
          return record;
        } catch (error) {
          if (!(error instanceof ConditionalCheckFailedException)) {
            throw error;
          }
          // Someone else wrote this key first. Their hit counted; re-read and
          // apply ours on top of the state they left.
        }
      }

      this.logger.warn(
        `Gave up counting a request against ${itemKey} after ${MAX_ATTEMPTS} contended attempts`,
      );
    } catch (error) {
      this.logger.error(
        `Rate limit storage unavailable, allowing request for ${itemKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Both paths above fall through to here, and both let the request pass.
    //
    // This is a deliberate choice and the one worth arguing about: a rate
    // limiter whose store is unreachable can either refuse every request or
    // count none of them. Refusing takes the whole site down — including the
    // public blog, which has no security stake in the limit at all — for a
    // dependency that exists only to bound abuse. Allowing means an attacker
    // who could also knock over DynamoDB gets an unmetered window.
    //
    // For this app availability wins. If a route ever needs the opposite, it
    // needs a second named throttler with its own storage, so that failing
    // closed applies only where it is worth the outage.
    return {
      totalHits: 1,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  private async read(
    itemKey: string,
  ): Promise<{ window: ThrottleWindow; version: number } | null> {
    const { Item } = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { pk: { S: itemKey } },
        // A limit counted off a stale replica is not a limit. This is the one
        // place the extra read-capacity cost of a consistent read is the point.
        ConsistentRead: true,
      }),
    );

    if (!Item) {
      return null;
    }

    return {
      window: {
        totalHits: Number(Item.totalHits?.N ?? 0),
        windowEndsAt: Number(Item.windowEndsAt?.N ?? 0),
        blockedUntil: Number(Item.blockedUntil?.N ?? 0),
      },
      version: Number(Item.version?.N ?? 0),
    };
  }

  private async write(
    itemKey: string,
    window: ThrottleWindow,
    currentVersion: number | null,
  ): Promise<void> {
    const expiresAt =
      Math.ceil(window.windowEndsAt / 1000) + GARBAGE_COLLECTION_GRACE_SECONDS;

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          pk: { S: itemKey },
          totalHits: { N: String(window.totalHits) },
          windowEndsAt: { N: String(window.windowEndsAt) },
          blockedUntil: { N: String(window.blockedUntil) },
          version: { N: String((currentVersion ?? 0) + 1) },
          expiresAt: { N: String(expiresAt) },
        },
        ConditionExpression:
          currentVersion === null
            ? 'attribute_not_exists(pk)'
            : 'version = :version',
        ExpressionAttributeValues:
          currentVersion === null
            ? undefined
            : { ':version': { N: String(currentVersion) } },
      }),
    );
  }
}
