import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/cli.ts',
        'src/**/index.ts',
        'src/**/*.d.ts',
        // NestJS wiring files (DI registration only — no logic):
        'src/**/*.module.ts',
        // Infrastructure-dependent files — covered by integration tests, not unit tests:
        //   Redis required:
        'src/pipeline/bullmq.runner.ts',
        //   Real CLI subprocess required (claude/codex/gemini in print mode):
        'src/governor/agent-adapter.ts',
        //   Native better-sqlite3 binding required:
        'src/persistence/prisma.client.ts',
        //   TTY-dependent ora spinners:
        'src/report/progress/terminal-ui.ts',
        //   CLI commands that shell out to docker / readline / Prisma — covered by E2E (Phase T SM-53):
        'src/cli/commands/clean.command.ts',
        'src/cli/commands/stop.command.ts',
        'src/cli/commands/doctor.command.ts',
        'src/cli/commands/history.command.ts',
        'src/cli/commands/report.command.ts',
        'src/cli/commands/diff.command.ts',
        // Type-only files:
        'src/pipeline/types.ts',
        'src/governor/types/governor-decision.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
