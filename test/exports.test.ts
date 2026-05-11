import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

import packageJson from "../package.json" with { type: "json" };

interface CoreEntrypoint {
  readonly decode: <T = unknown>(data: Iterable<[string, FormDataEntryValue]>) => T;
  readonly encode: (input: unknown) => [string, string][];
}

interface ClientEntrypoint {
  readonly createChangeHandlers: () => unknown;
}

describe("package exports", () => {
  test("declares root, core, and client subpaths", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([".", "./client", "./core"]);
  });

  test("builds and imports each public subpath", async () => {
    const build = Bun.spawnSync(["bun", "run", "build"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(build.exitCode, new TextDecoder().decode(build.stderr)).toBe(0);

    const root = (await import(packageJson.name)) as CoreEntrypoint;
    const core = (await import(`${packageJson.name}/core`)) as CoreEntrypoint;
    const client = (await import(`${packageJson.name}/client`)) as ClientEntrypoint;
    const require = createRequire(import.meta.url);
    const cjsCore = require(`${packageJson.name}/core`) as CoreEntrypoint;
    const cjsClient = require(`${packageJson.name}/client`) as ClientEntrypoint;

    expect(root.encode({ count: 1 })).toContainEqual(["count", "1"]);
    expect(
      core.decode<{ readonly createdAt: Date }>(
        core.encode({ createdAt: new Date("2024-01-01T00:00:00.000Z") }),
      ),
    ).toEqual({
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    expect(client.createChangeHandlers).toBeFunction();
    expect(cjsCore.encode({ count: 1 })).toContainEqual(["count", "1"]);
    expect(cjsClient.createChangeHandlers).toBeFunction();
  });
});
