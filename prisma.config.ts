// Prisma 7 top-level config file.
//
// Purpose:
//   - Tells `prisma migrate`, `prisma generate`, and `prisma studio` how to connect
//     during development, without coupling the connection URL to schema.prisma.
//   - Runtime PrismaClient construction happens in `src/persistence/prisma.client.ts`
//     using `@prisma/adapter-better-sqlite3` with the same DATABASE_URL value.
//
// The `datasource.url` is required for `prisma migrate deploy` to know which
// database to target. Without it, the migration command fails with:
//   "Error: The datasource.url property is required in your Prisma config file"
//
// See https://pris.ly/d/prisma7-config-datasource

import path from 'node:path';

type PrismaConfig = {
  schema: string;
  migrations?: {
    path: string;
  };
  datasource?: {
    url: string;
  };
};

const config: PrismaConfig = {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./data/sentinel.db',
  },
};

export default config;
