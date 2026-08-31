import { Logger } from '@nestjs/common';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';

const logger = new Logger('ParameterStore');

/**
 * Fills `process.env` from SSM Parameter Store before the app is built.
 *
 * The alternative is Lambda environment variables, and the reason not to use
 * them is where the values end up rather than how they are read. A value set
 * on the function has to come from somewhere: hardcoded in the Terraform, or
 * read by Terraform and written to the function — and in both cases it lands
 * in the state file, which is a copy of every secret sitting in a bucket
 * nobody thinks of as holding secrets. Reading them at runtime means
 * Terraform creates the *parameters* and never learns their contents.
 *
 * Called once per execution environment rather than once per request: it runs
 * inside the cached bootstrap, so it costs part of a cold start and nothing
 * afterwards.
 *
 * Doing nothing when no prefix is configured is what keeps `npm run start:dev`
 * and the e2e suite untouched — there, `.env` and the shell are the source and
 * this code never runs.
 */
export async function loadConfigFromParameterStore(): Promise<string[]> {
  const prefix = process.env.CONFIG_PARAMETER_PREFIX;

  if (!prefix) {
    return [];
  }

  // No explicit credentials: on Lambda this resolves to the function's
  // execution role. Handing a role-bearing runtime a static key pair as well
  // would be two answers to one question, and the wrong one usually wins.
  const client = new SSMClient({});
  const loaded: string[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        // SecureString parameters come back encrypted otherwise, and the
        // failure is quiet: the app boots with ciphertext where a password
        // should be and fails on first use.
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );

    for (const parameter of page.Parameters ?? []) {
      const name = parameter.Name?.split('/').pop();

      if (!name || parameter.Value === undefined) {
        continue;
      }

      // Anything already in the environment wins. That ordering is what lets
      // a single variable be overridden for a one-off debug run without
      // touching the store, and it matches how dotenv behaves everywhere else
      // in this project.
      if (process.env[name] !== undefined) {
        continue;
      }

      process.env[name] = parameter.Value;
      loaded.push(name);
    }

    nextToken = page.NextToken;
  } while (nextToken);

  // Names only. Logging a count would be useless when something is missing,
  // and logging values would defeat the point of the store.
  logger.log(
    `Loaded ${loaded.length} parameters from ${prefix}: ${loaded.sort().join(', ')}`,
  );

  return loaded;
}
