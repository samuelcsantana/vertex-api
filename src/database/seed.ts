import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { slugify } from '../common/utils/slugify.util';

const DEFAULT_TOPICS = [
  'Engenharia de Software',
  'Lifestyle',
  'Micro-frontends',
  'Angular',
  'Cafés Especiais',
  'Hardware & Setup',
  'Diablo & RPGs',
  'Smart Home',
  'Viagens pelo Nordeste',
];

async function seedTopics() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const existingTopics = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .limit(1);

    if (existingTopics.length > 0) {
      console.log('Topics table already has data, skipping seed.');
      return;
    }

    await db
      .insert(schema.topics)
      .values(DEFAULT_TOPICS.map((name) => ({ name, slug: slugify(name) })));

    console.log(`Seeded ${DEFAULT_TOPICS.length} default topics.`);
  } finally {
    await client.end();
  }
}

seedTopics().catch((error) => {
  console.error('Failed to seed topics:', error);
  process.exit(1);
});
