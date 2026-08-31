import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import { postgresClientOptions } from './postgres-options';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private client: Sql;
  public db: PostgresJsDatabase<typeof schema>;

  onModuleInit() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined');
    }

    this.client = postgres(connectionString, postgresClientOptions);
    this.db = drizzle(this.client, { schema });

    this.logger.log('Database connection established');
  }

  async onModuleDestroy() {
    await this.client.end();
    this.logger.log('Database connection closed');
  }
}
