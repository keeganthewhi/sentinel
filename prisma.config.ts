// Prisma 7 top-level config file.
//
// Purpose:
//   - Tells `prisma migrate`, `prisma generate`, and `prisma studio` how to connect
//     during development, without coupling the connection URL to schema.prisma.
//   - Runtime PrismaClient construction happens in `src/persistence/prisma.client.ts`
//     using `@prisma/adapter-better-sqlite3` with the same DATABASE_URL value.
//
// See https://pris.ly/d/prisma7-config-datasource

import path from 'node:path';

type PrismaConfig = {
  schema: string;
  migrations?: {
    path: string;
  };
};

const config: PrismaConfig = {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
};

export default config;
