import { Logger } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DynamoDbThrottlerStorage } from './dynamodb-throttler-storage';

const logger = new Logger('ThrottlerStorage');

/**
 * Chooses where rate-limit counters live, from the environment.
 *
 * Returning `undefined` leaves @nestjs/throttler on its in-memory storage,
 * which is the right answer for a single process and stays the default here on
 * purpose. Shared storage is not free: the throttler guard runs on *every*
 * route, so a remote counter turns every request — a blog page view included —
 * into a network round trip. That is a good trade when the store is next door
 * to the compute and a bad one when it is on another continent, and only the
 * deployment knows which it is. Hence a variable rather than a hardcoded
 * choice: the same image is correct on one instance and on many.
 *
 * The pattern is the one EmailSender already uses in AuthModule — pick the
 * real implementation when it is configured, a working default when it is not.
 * Unlike EmailSender this does not throw in production, because an in-memory
 * limit on a single instance is correct rather than broken. It does say so out
 * loud, since the same silence would be a real hole on a second instance.
 */
export function createThrottlerStorage(): ThrottlerStorage | undefined {
  const tableName = process.env.THROTTLER_DDB_TABLE;

  if (!tableName) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'THROTTLER_DDB_TABLE is not set: rate limits are counted per process. ' +
          'Correct on a single instance; on more than one, every instance ' +
          'grants the full limit on its own.',
      );
    }

    return undefined;
  }

  const region = process.env.THROTTLER_DDB_REGION ?? process.env.AWS_REGION;

  if (!region) {
    throw new Error(
      'THROTTLER_DDB_TABLE is set but no region is: set THROTTLER_DDB_REGION or AWS_REGION',
    );
  }

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  const client = new DynamoDBClient({
    region,
    // Static keys only when both are present. Left out, the SDK falls back to
    // its own credential chain, which is what picks up an execution role —
    // the form this app will have when it stops being a long-lived process
    // with environment variables baked into a dashboard.
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });

  logger.log(`Rate limits are counted in DynamoDB table ${tableName}`);

  return new DynamoDbThrottlerStorage(client, tableName);
}
