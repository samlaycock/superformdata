import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

import packageJson from "../package.json" with { type: "json" };

interface CoreEntrypoint {
  readonly decode: <T = unknown>(data: Iterable<[string, FormDataEntryValue]>) => T;
  readonly encode: (input: unknown) => [string, string][];
}

interface ClientEntrypoint {
  readonly createChangeHandlers: () => unknown;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertContainsEntry(
  entries: readonly (readonly [string, string])[],
  expected: readonly [string, string],
): void {
  assert(
    entries.some(([key, value]) => key === expected[0] && value === expected[1]),
    `Expected entries to contain ${JSON.stringify(expected)}, received ${JSON.stringify(entries)}`,
  );
}

function outputOf(result: ReturnType<typeof Bun.spawnSync>): string {
  return `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
}

async function smokeRuntimeEntrypoints(): Promise<void> {
  const root = (await import(packageJson.name)) as CoreEntrypoint;
  const core = (await import(`${packageJson.name}/core`)) as CoreEntrypoint;
  const client = (await import(`${packageJson.name}/client`)) as ClientEntrypoint;
  const require = createRequire(import.meta.url);
  const cjsRoot = require(packageJson.name) as CoreEntrypoint;
  const cjsCore = require(`${packageJson.name}/core`) as CoreEntrypoint;
  const cjsClient = require(`${packageJson.name}/client`) as ClientEntrypoint;
  const decoded = core.decode<{ readonly createdAt: Date }>(
    core.encode({ createdAt: new Date("2024-01-01T00:00:00.000Z") }),
  );

  assertContainsEntry(root.encode({ count: 1 }), ["count", "1"]);
  assertContainsEntry(cjsRoot.encode({ count: 1 }), ["count", "1"]);
  assert(
    isDeepStrictEqual(decoded, { createdAt: new Date("2024-01-01T00:00:00.000Z") }),
    `Expected Date roundtrip through built core entrypoint, received ${JSON.stringify(decoded)}`,
  );
  assert(
    typeof client.createChangeHandlers === "function",
    "Expected built ESM client entrypoint to export createChangeHandlers",
  );
  assertContainsEntry(cjsCore.encode({ count: 1 }), ["count", "1"]);
  assert(
    typeof cjsClient.createChangeHandlers === "function",
    "Expected built CJS client entrypoint to export createChangeHandlers",
  );
}

async function smokeSubpathTypes(): Promise<void> {
  const workspace = await Bun.$`mktemp -d`.text();
  const tempDir = workspace.trim();
  const packageDir = import.meta.dir + "/..";

  try {
    await Bun.$`mkdir -p ${tempDir}/node_modules`;
    await Bun.$`ln -s ${packageDir} ${tempDir}/node_modules/${packageJson.name}`;

    await Bun.write(
      `${tempDir}/index.ts`,
      `
import { decode, encode, type TypeHandler } from "${packageJson.name}/core";
import { createChangeHandlers, type ChangeHandlers } from "${packageJson.name}/client";

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

    assert(typecheck.exitCode === 0, outputOf(typecheck));
  } finally {
    await Bun.$`rm -rf ${tempDir}`;
  }
}

await smokeRuntimeEntrypoints();
await smokeSubpathTypes();
