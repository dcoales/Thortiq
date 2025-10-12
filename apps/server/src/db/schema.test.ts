import { describe, expect, it, vi } from "vitest";

import { INITIAL_MIGRATION, applyMigration } from "./schema";

describe("identity schema", () => {
  it("includes core tables", () => {
    const statements = INITIAL_MIGRATION.statements.join("\n");

    expect(statements).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS credentials");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS oauth_providers");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS mfa_methods");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS audit_logs");
  });

  it("applies statements in order", async () => {
    const exec = vi.fn();

    await applyMigration(INITIAL_MIGRATION, { exec });

    expect(exec).toHaveBeenCalledTimes(INITIAL_MIGRATION.statements.length);
    expect(exec.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS users");
  });
});
