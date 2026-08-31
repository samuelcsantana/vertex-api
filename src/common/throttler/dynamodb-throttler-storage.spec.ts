import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDbThrottlerStorage } from './dynamodb-throttler-storage';

const TABLE = 'vertex-api-throttler';
const TTL = 60_000;
const LIMIT = 5;

function conditionalFailure(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    $metadata: {},
    message: 'The conditional request failed',
  });
}

// jest.Mock types mock.calls as any, so every reach into a captured command
// trips no-unsafe-member-access. These two contain the cast in one place and
// hand back the command already typed.
function sentGet(send: jest.Mock, index: number): GetItemCommand {
  return (send.mock.calls as unknown as GetItemCommand[][])[index][0];
}

function sentPut(send: jest.Mock, index: number): PutItemCommand {
  return (send.mock.calls as unknown as PutItemCommand[][])[index][0];
}

// The window logic itself is covered by throttle-window.spec.ts. What is left
// for this class is the part that only exists because the state is remote:
// reading consistently, writing under a version check, retrying a lost race,
// and deciding what happens when the table cannot be reached at all.
describe('DynamoDbThrottlerStorage', () => {
  function createStorage(sendImpl: jest.Mock) {
    const client = { send: sendImpl } as unknown as DynamoDBClient;

    return {
      storage: new DynamoDbThrottlerStorage(client, TABLE),
      send: sendImpl,
    };
  }

  function item(overrides: Record<string, { N: string } | { S: string }> = {}) {
    return {
      Item: {
        pk: { S: 'default:key' },
        totalHits: { N: '1' },
        windowEndsAt: { N: String(Date.now() + 30_000) },
        blockedUntil: { N: '0' },
        version: { N: '4' },
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads consistently — a limit counted off a stale replica is not a limit', async () => {
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof GetItemCommand) return Promise.resolve({});
      return Promise.resolve({});
    });
    const { storage } = createStorage(send);

    await storage.increment('key', TTL, LIMIT, TTL, 'default');

    const get = sentGet(send, 0);
    expect(get.input.ConsistentRead).toBe(true);
    expect(get.input.Key).toEqual({ pk: { S: 'default:key' } });
  });

  it('creates the first item with a guard against a concurrent create', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { storage } = createStorage(send);

    await storage.increment('key', TTL, LIMIT, TTL, 'default');

    const put = sentPut(send, 1);
    expect(put.input.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(put.input.Item?.version).toEqual({ N: '1' });
  });

  it('writes an update only if the version it read is still current', async () => {
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof GetItemCommand) return Promise.resolve(item());
      return Promise.resolve({});
    });
    const { storage } = createStorage(send);

    await storage.increment('key', TTL, LIMIT, TTL, 'default');

    const put = sentPut(send, 1);
    expect(put.input.ConditionExpression).toBe('version = :version');
    expect(put.input.ExpressionAttributeValues).toEqual({
      ':version': { N: '4' },
    });
    expect(put.input.Item?.version).toEqual({ N: '5' });
  });

  it('sets a TTL attribute that outlives the window it collects', async () => {
    // DynamoDB deletes expired items "typically within two days", and serves
    // them in reads until it does — so the attribute is housekeeping, and the
    // window must already be over well before it fires.
    const windowEndsAt = Date.now() + 30_000;
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve(
          item({ windowEndsAt: { N: String(windowEndsAt) } }),
        );
      }
      return Promise.resolve({});
    });
    const { storage } = createStorage(send);

    await storage.increment('key', TTL, LIMIT, TTL, 'default');

    const put = sentPut(send, 1);
    const expiresAt = Number(put.input.Item?.expiresAt?.N);
    expect(expiresAt).toBeGreaterThan(Math.ceil(windowEndsAt / 1000));
  });

  it('retries against the winner when another request writes first', async () => {
    let gets = 0;
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof GetItemCommand) {
        gets += 1;
        return Promise.resolve(
          item({
            totalHits: { N: String(gets) },
            version: { N: String(gets) },
          }),
        );
      }
      // The first write loses the race; the second one lands.
      return gets === 1
        ? Promise.reject(conditionalFailure())
        : Promise.resolve({});
    });
    const { storage } = createStorage(send);

    const record = await storage.increment('key', TTL, LIMIT, TTL, 'default');

    expect(gets).toBe(2);
    // Counted on top of what the winner left behind, not on top of the state
    // this call first read.
    expect(record.totalHits).toBe(3);
  });

  it('lets the request through when the table cannot be reached', async () => {
    // The trade is stated in the class: refusing every request would take the
    // public blog down over a dependency that only exists to bound abuse.
    const send = jest.fn().mockRejectedValue(new Error('network is down'));
    const { storage } = createStorage(send);

    const record = await storage.increment('key', TTL, LIMIT, TTL, 'default');

    expect(record.isBlocked).toBe(false);
    expect(record.totalHits).toBe(1);
  });

  it('lets the request through when contention never resolves', async () => {
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof GetItemCommand) return Promise.resolve(item());
      return Promise.reject(conditionalFailure());
    });
    const { storage } = createStorage(send);

    const record = await storage.increment('key', TTL, LIMIT, TTL, 'default');

    expect(record.isBlocked).toBe(false);
    // Three attempts, each a read and a write.
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('keys items by throttler name so named limits cannot share a counter', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { storage } = createStorage(send);

    await storage.increment('1.2.3.4', TTL, LIMIT, TTL, 'strict');

    const get = sentGet(send, 0);
    expect(get.input.Key).toEqual({ pk: { S: 'strict:1.2.3.4' } });
  });
});
