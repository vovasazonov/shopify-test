import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function createTestDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "cod-order-watch-tests-"));
  const url = pathToFileURL(path.join(directory, "dev.sqlite")).href;
  let client: PrismaClient | undefined;

  async function dispose() {
    try {
      await client?.$disconnect();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  try {
    // Copy the real schema and migrations so its relative SQLite path resolves
    // inside this suite's disposable directory, never to the development DB.
    cpSync(
      path.join(projectRoot, "prisma/schema.prisma"),
      path.join(directory, "schema.prisma"),
    );
    cpSync(
      path.join(projectRoot, "prisma/migrations"),
      path.join(directory, "migrations"),
      { recursive: true },
    );
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        path.join(directory, "schema.prisma"),
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, RUST_LOG: "info" },
        stdio: "pipe",
      },
    );
    client = new PrismaClient({ datasourceUrl: url });
    await client.$connect();
    return { client, url, dispose };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Test database setup and cleanup failed",
      );
    }
    throw error;
  }
}
