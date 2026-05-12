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
    const cjsRoot = require(packageJson.name) as CoreEntrypoint;
    const cjsCore = require(`${packageJson.name}/core`) as CoreEntrypoint;
    const cjsClient = require(`${packageJson.name}/client`) as ClientEntrypoint;

    expect(root.encode({ count: 1 })).toContainEqual(["count", "1"]);
    expect(cjsRoot.encode({ count: 1 })).toContainEqual(["count", "1"]);
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

  test('resolves subpath types with moduleResolution "node"', async () => {
    const build = Bun.spawnSync(["bun", "run", "build"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(build.exitCode, new TextDecoder().decode(build.stderr)).toBe(0);

    const workspace = await Bun.$`mktemp -d`.text();
    const tempDir = workspace.trim();
    const packageDir = import.meta.dir + "/..";

    await Bun.$`mkdir -p ${tempDir}/node_modules`;
    await Bun.$`ln -s ${packageDir} ${tempDir}/node_modules/${packageJson.name}`;

    await Bun.write(
      `${tempDir}/index.ts`,
      `
import { decode, encode, type TypeHandler } from "superformdata/core";
import { createChangeHandlers, type ChangeHandlers } from "superformdata/client";

const entries = encode({ count: 1 });
const decoded = decode<{ readonly count: number }>(entries);
const handlers: ChangeHandlers = createChangeHandlers();
const typeHandler: TypeHandler<unknown> = {
  id: "unknown",
  test: (value): value is unknown => value !== undefined,
  serialize: String,
  deserialize: (raw) => raw,
};

void decoded;
void handlers;
void typeHandler;
`,
    );
    await Bun.write(
      `${tempDir}/tsconfig.json`,
      JSON.stringify(
        {
          compilerOptions: {
            lib: ["esnext", "dom", "dom.iterable"],
            module: "esnext",
            moduleResolution: "node",
            noEmit: true,
            strict: true,
            target: "esnext",
          },
          files: ["index.ts"],
        },
        null,
        2,
      ),
    );

    const typecheck = Bun.spawnSync(["bun", "x", "tsc", "--project", tempDir], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = `${new TextDecoder().decode(typecheck.stdout)}${new TextDecoder().decode(typecheck.stderr)}`;

    expect(typecheck.exitCode, output).toBe(0);
  });
});
