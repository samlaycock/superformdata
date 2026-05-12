import { decode, encode } from "../src/core.ts";

interface BenchmarkCase {
  readonly name: string;
  readonly iterations: number;
  readonly createInput: () => unknown;
}

interface Measurement {
  readonly totalMs: number;
  readonly msPerOp: number;
  readonly opsPerSecond: number;
}

interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly entries: number;
  readonly encode: Measurement;
  readonly decode: Measurement;
}

const WARMUP_ITERATIONS = 10;
const NS_PER_MS = 1_000_000;
const MS_PER_SECOND = 1_000;

const benchmarkCases: readonly BenchmarkCase[] = [
  {
    name: "large flat object",
    iterations: 500,
    createInput: () =>
      Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [
          `field${index}`,
          index % 4 === 0 ? index : `value-${index}`,
        ]),
      ),
  },
  {
    name: "deeply nested object",
    iterations: 1_000,
    createInput: () => createNestedObject(120),
  },
  {
    name: "repeated fields / FormData-like input",
    iterations: 1_000,
    createInput: () => {
      const params = new URLSearchParams();
      for (let i = 0; i < 300; i++) {
        params.append("tag", `tag-${i}`);
        params.append(`group.${i % 10}`, `value-${i}`);
      }
      return params;
    },
  },
  {
    name: "arrays, sparse arrays, Set, and Map",
    iterations: 500,
    createInput: () => {
      const sparse: unknown[] = ["start"];
      sparse[250] = "middle";
      sparse[999] = "end";

      return {
        dense: Array.from({ length: 250 }, (_, index) => ({
          index,
          label: `item-${index}`,
        })),
        sparse,
        set: new Set(Array.from({ length: 250 }, (_, index) => `set-${index}`)),
        map: new Map(
          Array.from({ length: 250 }, (_, index) => [
            `key-${index}`,
            { count: index, active: index % 2 === 0 },
          ]),
        ),
      };
    },
  },
  {
    name: "heavy typed payload",
    iterations: 500,
    createInput: () => ({
      dates: Array.from({ length: 100 }, (_, index) => new Date(Date.UTC(2024, 0, index + 1))),
      numbers: [
        0,
        -0,
        NaN,
        Infinity,
        -Infinity,
        ...Array.from({ length: 100 }, (_, index) => index),
      ],
      booleans: Array.from({ length: 100 }, (_, index) => index % 2 === 0),
      bigints: Array.from({ length: 100 }, (_, index) => BigInt(Number.MAX_SAFE_INTEGER + index)),
      urls: Array.from({ length: 100 }, (_, index) => new URL(`https://example.com/${index}`)),
      patterns: Array.from({ length: 100 }, (_, index) => new RegExp(`item-${index}`, "gi")),
      errors: Array.from({ length: 100 }, (_, index) => new Error(`Failure ${index}`)),
    }),
  },
];

const results = benchmarkCases.map(runCase);

console.log("superformdata benchmark results");
console.log(`Bun ${Bun.version}`);
console.log("");
console.table(
  results.map((result) => ({
    workload: result.name,
    iterations: result.iterations,
    entries: result.entries,
    "encode ms/op": formatNumber(result.encode.msPerOp),
    "encode ops/sec": formatNumber(result.encode.opsPerSecond),
    "decode ms/op": formatNumber(result.decode.msPerOp),
    "decode ops/sec": formatNumber(result.decode.opsPerSecond),
  })),
);

function runCase(benchmarkCase: BenchmarkCase): BenchmarkResult {
  const input = benchmarkCase.createInput();
  const encoded = encode(input);

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    consume(encode(input));
    consume(decode(encoded));
  }

  const encodeMeasurement = measure(benchmarkCase.iterations, () => encode(input));
  const decodeMeasurement = measure(benchmarkCase.iterations, () => decode(encoded));

  return {
    name: benchmarkCase.name,
    iterations: benchmarkCase.iterations,
    entries: encoded.length,
    encode: encodeMeasurement,
    decode: decodeMeasurement,
  };
}

function measure(iterations: number, fn: () => unknown): Measurement {
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) {
    consume(fn());
  }
  const totalMs = (Bun.nanoseconds() - start) / NS_PER_MS;
  const msPerOp = totalMs / iterations;

  return {
    totalMs,
    msPerOp,
    opsPerSecond: MS_PER_SECOND / msPerOp,
  };
}

function createNestedObject(depth: number): unknown {
  let value: unknown = {
    id: "leaf",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    count: 42,
  };

  for (let i = depth; i > 0; i--) {
    value = {
      [`level${i}`]: value,
      sibling: `value-${i}`,
    };
  }

  return value;
}

function consume(value: unknown): void {
  if (value === undefined) {
    throw new Error("Unexpected undefined benchmark result");
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  });
}
