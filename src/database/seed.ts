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

const DEFAULT_ABOUT_CONTENT = `# Olá, eu sou o Samuel Santana.

Sou Desenvolvedor Frontend Sênior com foco em arquiteturas web modernas, escalabilidade e performance. No meu dia a dia, atuo desenvolvendo soluções robustas utilizando **React**, **Angular** e explorando padrões corporativos como Micro-frontends e Module Federation.

Gosto de entender como as coisas funcionam por baixo dos panos, otimizar workflows, testar hardwares de alta performance e até configurar LLMs locais para explorar as capacidades da máquina.

---

## Além do Código

Escrevo e codifico diretamente de Salvador, Bahia. Quando a IDE está fechada, meu foco geralmente se volta para:

*   **Cafés Especiais:** Sou um entusiasta da extração perfeita. Gostos de testar receitas, ajustar a moagem e usar métodos como a Moka ou filtros de metal para tirar as melhores notas de grãos de qualidade.
*   **RPGs e Ação:** O setup também é dedicado a explorar *builds* em *Diablo IV*, *Diablo Immortal* e *Genshin Impact*.
*   **O Supervisor:** Toda essa rotina acontece sob a supervisão rigorosa do meu gato de 11 anos, Guindas (carinhosamente chamado de Greninho ou Gandalf), que é o verdadeiro dono do escritório.

---

## O Propósito deste Espaço

Este blog nasceu como um laboratório pessoal. Aqui documento meus aprendizados em Engenharia de Software, compartilho dicas de setup e hardware, e escrevo sobre tecnologia e estilo de vida de forma autêntica.

Sinta-se à vontade para interagir na área de comentários dos artigos ou conectar-se comigo profissionalmente:

*   [GitHub](https://github.com/)
*   [LinkedIn](https://linkedin.com/in/)
`;

async function seedTopics(db: ReturnType<typeof drizzle<typeof schema>>) {
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
}

async function seedAboutContent(db: ReturnType<typeof drizzle<typeof schema>>) {
  const existing = await db
    .select({ id: schema.aboutContent.id })
    .from(schema.aboutContent)
    .limit(1);

  if (existing.length > 0) {
    console.log('About content already exists, skipping seed.');
    return;
  }

  await db.insert(schema.aboutContent).values({ content: DEFAULT_ABOUT_CONTENT });

  console.log('Seeded default About content.');
}

async function seed() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    await seedTopics(db);
    await seedAboutContent(db);
  } finally {
    await client.end();
  }
}

seed().catch((error) => {
  console.error('Failed to seed database:', error);
  process.exit(1);
});
