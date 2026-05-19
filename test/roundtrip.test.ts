import { describe, expect, test } from "bun:test";

import { decode, decodeRequest } from "../src/decode.ts";
import { encode } from "../src/encode.ts";

function roundtrip(value: unknown): unknown {
  return decode(encode(value));
}

describe("encode/decode round-trip", () => {
  test("simple string object", () => {
    const input = { name: "Alice", city: "NYC" };
    expect(roundtrip(input)).toEqual(input);
  });

  test("object with Date", () => {
    const input = { createdAt: new Date("2024-01-01T00:00:00.000Z") };
    const result = roundtrip(input) as { createdAt: Date };
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("object with number and boolean", () => {
    const input = { count: 42, active: true, ratio: 3.14, off: false };
    expect(roundtrip(input)).toEqual(input);
  });

  test("object with null and undefined", () => {
    const input = { a: null, b: undefined };
    expect(roundtrip(input)).toEqual(input);
  });

  test("nested objects", () => {
    const input = { user: { address: { city: "NYC", zip: 10001 } } };
    expect(roundtrip(input)).toEqual(input);
  });

  test("arrays", () => {
    const input = { scores: [100, 200, 300] };
    expect(roundtrip(input)).toEqual(input);
  });

  test("Set of strings", () => {
    const input = { tags: new Set(["a", "b", "c"]) };
    const result = roundtrip(input) as { tags: Set<string> };
    expect(result.tags).toBeInstanceOf(Set);
    expect(result.tags).toEqual(new Set(["a", "b", "c"]));
  });

  test("Set of numbers", () => {
    const input = { nums: new Set([1, 2, 3]) };
    const result = roundtrip(input) as { nums: Set<number> };
    expect(result.nums).toBeInstanceOf(Set);
    expect(result.nums).toEqual(new Set([1, 2, 3]));
  });

  test("Map with string keys", () => {
    const input = {
      mapping: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    };
    const result = roundtrip(input) as { mapping: Map<string, number> };
    expect(result.mapping).toBeInstanceOf(Map);
    expect(result.mapping.get("a")).toBe(1);
    expect(result.mapping.get("b")).toBe(2);
  });

  test("Map with non-string keys", () => {
    const d1 = new Date("2024-01-01T00:00:00.000Z");
    const d2 = new Date("2024-06-01T00:00:00.000Z");
    const input = {
      m: new Map<Date, number>([
        [d1, 10],
        [d2, 20],
      ]),
    };
    const result = roundtrip(input) as { m: Map<Date, number> };
    expect(result.m).toBeInstanceOf(Map);
    const entries = [...result.m.entries()];
    expect(entries[0]![0]).toBeInstanceOf(Date);
    expect((entries[0]![0] as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(entries[0]![1]).toBe(10);
  });

  test("BigInt", () => {
    const input = { big: 9007199254740993n };
    expect(roundtrip(input)).toEqual(input);
  });

  test("RegExp", () => {
    const input = { pattern: /^hello\s+world$/gi };
    const result = roundtrip(input) as { pattern: RegExp };
    expect(result.pattern).toBeInstanceOf(RegExp);
    expect(result.pattern.source).toBe("^hello\\s+world$");
    expect(result.pattern.flags).toBe("gi");
  });

  test("URL", () => {
    const input = { link: new URL("https://example.com/path?q=1") };
    const result = roundtrip(input) as { link: URL };
    expect(result.link).toBeInstanceOf(URL);
    expect(result.link.href).toBe("https://example.com/path?q=1");
  });

  test("Error", () => {
    const input = { err: new Error("something went wrong") };
    const result = roundtrip(input) as { err: Error };
    expect(result.err).toBeInstanceOf(Error);
    expect(result.err.message).toBe("something went wrong");
  });

  test("Error preserves name and cause details", () => {
    const input = {
      err: new TypeError("bad input", { cause: new Error("root cause") }),
    };

    const result = roundtrip(input) as { err: Error };

    expect(result.err).toBeInstanceOf(Error);
    expect(result.err.name).toBe("TypeError");
    expect(result.err.message).toBe("bad input");
    expect(result.err.cause).toBeInstanceOf(Error);
    expect((result.err.cause as Error).name).toBe("Error");
    expect((result.err.cause as Error).message).toBe("root cause");
  });

  test("Error with undefined cause does not create string cause", () => {
    const result = roundtrip(new Error("missing cause", { cause: undefined })) as Error;

    expect(result.message).toBe("missing cause");
    expect(result.cause).toBeUndefined();
  });

  test("Error with circular cause serializes without stack overflow", () => {
    const input = new Error("recursive");
    input.cause = input;

    const result = roundtrip(input) as Error;

    expect(result.message).toBe("recursive");
    expect(result.cause).toBe("[Circular Error cause]");
  });

  test("Error preserves JSON-compatible non-Error cause values", () => {
    const nullCause = roundtrip(new Error("null cause", { cause: null })) as Error;
    const numberCause = roundtrip(new Error("number cause", { cause: 42 })) as Error;
    const objectCause = roundtrip(
      new Error("object cause", { cause: { code: "E_TEST", retryable: false } }),
    ) as Error;

    expect(nullCause.cause).toBeNull();
    expect(numberCause.cause).toBe(42);
    expect(objectCause.cause).toEqual({ code: "E_TEST", retryable: false });
  });

  test("special numbers", () => {
    const input = { a: NaN, b: Infinity, c: -Infinity, d: -0 };
    const result = roundtrip(input) as Record<string, number>;
    expect(Number.isNaN(result.a)).toBe(true);
    expect(result.b).toBe(Infinity);
    expect(result.c).toBe(-Infinity);
    expect(Object.is(result.d, -0)).toBe(true);
  });

  test("empty containers", () => {
    const input = { arr: [] as unknown[], obj: {} };
    expect(roundtrip(input)).toEqual(input);
  });

  test("empty Set and Map", () => {
    const input = { s: new Set(), m: new Map() };
    const result = roundtrip(input) as { s: Set<unknown>; m: Map<unknown, unknown> };
    expect(result.s).toBeInstanceOf(Set);
    expect(result.s.size).toBe(0);
    expect(result.m).toBeInstanceOf(Map);
    expect(result.m.size).toBe(0);
  });

  test("keys with dots and brackets", () => {
    const input = { "a.b": { "c[0]": "value" } };
    expect(roundtrip(input)).toEqual(input);
  });

  test("top-level empty string object key", () => {
    const input = { "": "x" };
    expect(roundtrip(input)).toEqual(input);
  });

  test("nested empty string object key", () => {
    const input = { user: { "": "x" } };
    expect(roundtrip(input)).toEqual(input);
  });

  test("mixed empty string object keys with siblings", () => {
    const input = { "": "root", user: { "": "nested", name: "Alice" }, value: "sibling" };
    expect(roundtrip(input)).toEqual(input);
  });

  test("empty string object key with array value", () => {
    const input = { "": [1, 2], parent: { "": [3, 4] } };
    expect(roundtrip(input)).toEqual(input);
  });

  test("deeply nested mixed types", () => {
    const input = {
      users: [
        {
          name: "Alice",
          joined: new Date("2024-01-01T00:00:00.000Z"),
          tags: new Set(["admin", "user"]),
          prefs: { theme: "dark", count: 5 },
        },
      ],
    };
    const result = roundtrip(input) as {
      users: Array<{
        name: string;
        joined: Date;
        tags: Set<string>;
        prefs: { theme: string; count: number };
      }>;
    };
    expect(result.users[0]!.name).toBe("Alice");
    expect(result.users[0]!.joined).toBeInstanceOf(Date);
    expect(result.users[0]!.tags).toBeInstanceOf(Set);
    expect(result.users[0]!.tags).toEqual(new Set(["admin", "user"]));
    expect(result.users[0]!.prefs).toEqual({ theme: "dark", count: 5 });
  });

  test("top-level array", () => {
    const input = [1, 2, 3];
    expect(roundtrip(input)).toEqual(input);
  });

  test("top-level sparse array preserves holes", () => {
    const input: unknown[] = [];
    input[2] = "x";

    const result = roundtrip(input) as unknown[];

    expect(result).toHaveLength(3);
    expect(0 in result).toBe(false);
    expect(1 in result).toBe(false);
    expect(result[2]).toBe("x");
  });

  test("top-level sparse array preserves trailing holes", () => {
    const input = ["x"] as unknown[];
    input.length = 3;

    const result = roundtrip(input) as unknown[];

    expect(result).toHaveLength(3);
    expect(result[0]).toBe("x");
    expect(1 in result).toBe(false);
    expect(2 in result).toBe(false);
  });

  test("oversized sparse array throws before emitting undecodable metadata", () => {
    const input = ["x"] as unknown[];
    input.length = 100_001;

    expect(() => encode(input)).toThrow(
      new TypeError('Sparse array length too large at path "": 100001'),
    );
  });

  test("top-level Set", () => {
    const input = new Set(["a", "b", "c"]);
    const result = roundtrip(input);
    expect(result).toBeInstanceOf(Set);
    expect(result).toEqual(input);
  });

  test("top-level Map", () => {
    const input = new Map([
      ["x", 1],
      ["y", 2],
    ]);
    const result = roundtrip(input) as Map<string, number>;
    expect(result).toBeInstanceOf(Map);
    expect(result.get("x")).toBe(1);
    expect(result.get("y")).toBe(2);
  });

  test("top-level string", () => {
    expect(roundtrip("hello")).toBe("hello");
  });

  test("top-level number", () => {
    expect(roundtrip(42)).toBe(42);
  });

  test("top-level null", () => {
    expect(roundtrip(null)).toBeNull();
  });

  test("top-level undefined", () => {
    expect(roundtrip(undefined)).toBeUndefined();
  });

  test("top-level Date", () => {
    const input = new Date("2024-01-01T00:00:00.000Z");
    const result = roundtrip(input) as Date;
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("top-level invalid Date throws path-aware TypeError", () => {
    expect(() => encode(new Date("not-a-date"))).toThrow(new TypeError('Invalid Date at path ""'));
  });

  test("URLSearchParams encode as form-style entries", () => {
    expect(encode(new URLSearchParams("name=Alice&count=42&tag=a&tag=b"))).toEqual([
      ["name", "Alice"],
      ["count", "42"],
      ["tag", "a"],
      ["tag", "b"],
    ]);
  });

  test("URLSearchParams encode applies explicit types metadata", () => {
    expect(
      encode(new URLSearchParams("name=Alice&count=42"), {
        types: { count: "number" },
      }),
    ).toEqual([
      ["name", "Alice"],
      ["count", "42"],
      ["$types", JSON.stringify({ count: "number" })],
    ]);
  });

  test("URLSearchParams encode merges existing and explicit types metadata", () => {
    const params = new URLSearchParams("count=42&active=true");
    params.set("$types", JSON.stringify({ count: "number" }));

    expect(encode(params, { types: { active: "boolean" } })).toEqual([
      ["count", "42"],
      ["active", "true"],
      ["$types", JSON.stringify({ count: "number", active: "boolean" })],
    ]);
  });

  test("URLSearchParams explicit types override existing metadata", () => {
    const params = new URLSearchParams("count=42");
    params.set("$types", JSON.stringify({ count: "number" }));

    expect(encode(params, { types: { count: "bigint" } })).toEqual([
      ["count", "42"],
      ["$types", JSON.stringify({ count: "bigint" })],
    ]);
  });

  test("URLSearchParams encode throws on malformed existing metadata", () => {
    const params = new URLSearchParams("count=42");
    params.set("$types", "not json");

    expect(() => encode(params)).toThrow(
      'Invalid superformdata metadata: "$types" field contains malformed JSON',
    );
  });

  test("URLSearchParams encode throws on invalid existing metadata shape", () => {
    const params = new URLSearchParams("count=42");
    params.set("$types", JSON.stringify({ count: 30 }));

    expect(() => encode(params)).toThrow(
      'Invalid superformdata metadata: "$types" field must map paths to string type ids (path: "count")',
    );
  });

  test("nested invalid Date throws path-aware TypeError", () => {
    expect(() => encode({ post: { publishedAt: new Date("not-a-date") } })).toThrow(
      new TypeError('Invalid Date at path "post.publishedAt"'),
    );
  });

  test("top-level boolean", () => {
    expect(roundtrip(true)).toBe(true);
    expect(roundtrip(false)).toBe(false);
  });

  test("nested arrays", () => {
    const input = {
      matrix: [
        [1, 2],
        [3, 4],
      ],
    };
    expect(roundtrip(input)).toEqual(input);
  });

  test("nested sparse arrays preserve holes", () => {
    const input = {
      items: [] as unknown[],
    };
    input.items[1] = "x";
    input.items.length = 3;

    const result = roundtrip(input) as { items: unknown[] };

    expect(result.items).toHaveLength(3);
    expect(0 in result.items).toBe(false);
    expect(result.items[1]).toBe("x");
    expect(2 in result.items).toBe(false);
  });

  test("array of mixed types", () => {
    const input = [1, "two", true, null];
    expect(roundtrip(input)).toEqual(input);
  });

  test("nested empty containers", () => {
    const input = { a: { b: [], c: {} }, d: [] as unknown[] };
    expect(roundtrip(input)).toEqual(input);
  });

  test("decode reconstructs many sibling empty containers", () => {
    const types = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [`empty${index}`, "array"]),
    );
    const entries: [string, string][] = [
      ...Array.from({ length: 1_000 }, (_, index): [string, string] => [
        `value${index}`,
        String(index),
      ]),
      ["$types", JSON.stringify(types)],
    ];

    expect(decode(entries)).toEqual(
      Object.fromEntries([
        ...Array.from({ length: 1_000 }, (_, index) => [`value${index}`, String(index)]),
        ...Array.from({ length: 1_000 }, (_, index) => [`empty${index}`, []]),
      ]),
    );
  });

  test("decode rejects array indexes that would create sparse arrays", () => {
    expect(() => decode([["a[100000000]", "x"]])).toThrow("Array index too large");
  });

  test("decode rejects sparse array metadata shorter than decoded indexes", () => {
    expect(() =>
      decode([
        ["items[5]", "x"],
        ["$types", JSON.stringify({ items: "array:2" })],
      ]),
    ).toThrow(
      'Invalid superformdata metadata: sparse array length 2 at path "items" would truncate decoded index 5',
    );
  });

  test("decode rejects large sparse array metadata shorter than decoded indexes", () => {
    expect(() =>
      decode([
        ["items[100000]", "x"],
        ["$types", JSON.stringify({ items: "array:100000" })],
      ]),
    ).toThrow(
      'Invalid superformdata metadata: sparse array length 100000 at path "items" would truncate decoded index 100000',
    );
  });

  test("decode rejects malformed path syntax", () => {
    expect(() => decode([["items[0", "x"]])).toThrow(
      'Invalid path "items[0": missing closing bracket',
    );
    expect(() => decode([["name\\", "x"]])).toThrow(
      'Invalid path "name\\": trailing escape character',
    );
  });

  test("object with numeric string keys", () => {
    const input = { "0": "zero", "1": "one", name: "test" };
    const result = roundtrip(input) as Record<string, string>;
    expect(result).toEqual(input);
    expect(Array.isArray(result)).toBe(false);
  });

  test("Set of objects", () => {
    const input = {
      items: new Set([
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ]),
    };
    const result = roundtrip(input) as { items: Set<{ id: number; name: string }> };
    expect(result.items).toBeInstanceOf(Set);
    const arr = [...result.items];
    expect(arr).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  test("Map with typed values", () => {
    const input = {
      m: new Map<string, Date>([
        ["start", new Date("2024-01-01T00:00:00.000Z")],
        ["end", new Date("2024-12-31T00:00:00.000Z")],
      ]),
    };
    const result = roundtrip(input) as { m: Map<string, Date> };
    expect(result.m).toBeInstanceOf(Map);
    expect(result.m.get("start")).toBeInstanceOf(Date);
    expect(result.m.get("start")!.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(result.m.get("end")!.toISOString()).toBe("2024-12-31T00:00:00.000Z");
  });

  test("no $types field when all values are strings", () => {
    const input = { name: "Alice", city: "NYC" };
    const entries = encode(input);
    const keys = entries.map(([k]) => k);
    expect(keys).not.toContain("$types");
  });

  test("unsupported type throws", () => {
    class Foo {
      x = 1;
    }
    expect(() => encode({ f: new Foo() })).toThrow('Unsupported type "Foo"');
  });

  test("unsupported symbol throws", () => {
    expect(() => encode({ s: Symbol("test") })).toThrow("Unsupported type");
  });

  test("circular reference throws", () => {
    const obj: Record<string, unknown> = { name: "test" };
    obj.self = obj;
    expect(() => encode(obj)).toThrow("Circular reference");
  });

  test("circular reference in array throws", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => encode(arr)).toThrow("Circular reference");
  });

  test("shared reference (non-circular) works", () => {
    const shared = { x: 1 };
    const input = { a: shared, b: shared };
    expect(() => encode(input)).not.toThrow();
  });

  test("shared leaf object references work", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const input = { start: date, end: date };
    const result = roundtrip(input) as { start: Date; end: Date };
    expect(result.start).toBeInstanceOf(Date);
    expect(result.end).toBeInstanceOf(Date);
    expect(result.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("shared RegExp instance works", () => {
    const re = /test/g;
    const input = { a: re, b: re };
    const result = roundtrip(input) as { a: RegExp; b: RegExp };
    expect(result.a.source).toBe("test");
    expect(result.b.source).toBe("test");
  });

  test('encode preserves File values in plain objects when files option is "preserve"', () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" });

    expect(encode({ attachment: file }, { files: "preserve" })).toEqual([["attachment", file]]);
  });

  test("encode throws a file-specific error for plain object File values by default", () => {
    const file = new File(["content"], "test.txt");

    expect(() => encode({ attachment: file })).toThrow(
      'File values are not supported by superformdata at path "attachment"',
    );
  });

  test("encode throws when a preserved plain object File value uses the metadata key", () => {
    const file = new File(["content"], "metadata.txt");

    expect(() => encode({ $types: file }, { files: "preserve" })).toThrow(
      'Path "$types" is reserved for superformdata metadata',
    );
  });

  test("encode rejects root string data fields that use the metadata key", () => {
    expect(() => encode({ $types: "user data" })).toThrow(
      'Path "$types" is reserved for superformdata metadata; pass a different typesKey option or rename the root field.',
    );
  });

  test("encode rejects root typed data fields that use the metadata key", () => {
    expect(() => encode({ $types: 1 })).toThrow(
      'Path "$types" is reserved for superformdata metadata; pass a different typesKey option or rename the root field.',
    );
  });

  test("decode with no entries returns empty object", () => {
    expect(decode<Record<string, never>>([])).toEqual({});
  });

  test("decode rejects prototype pollution path segments", () => {
    expect(() => decode([["__proto__.polluted", "yes"]])).toThrow(
      'Unsafe path segment "__proto__"',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("decode throws on malformed $types JSON", () => {
    expect(() =>
      decode([
        ["name", "Alice"],
        ["$types", "not json"],
      ]),
    ).toThrow("malformed JSON");
  });

  test("decode throws on empty $types metadata", () => {
    expect(() => decode([["$types", ""]])).toThrow("malformed JSON");
  });

  test("decode throws on empty $types metadata alongside normal fields", () => {
    expect(() =>
      decode([
        ["name", "Alice"],
        ["$types", ""],
      ]),
    ).toThrow("malformed JSON");
  });

  test("decode throws on duplicate $types metadata", () => {
    expect(() =>
      decode([
        ["count", "42"],
        ["$types", JSON.stringify({ count: "number" })],
        ["$types", JSON.stringify({ count: "bigint" })],
      ]),
    ).toThrow('Invalid superformdata metadata: duplicate "$types" field');
  });

  test("decode throws on non-object $types metadata", () => {
    const invalidMetadata = ["null", "[]", '"string"', "42", "true"];

    for (const metadata of invalidMetadata) {
      expect(() =>
        decode([
          ["name", "Alice"],
          ["$types", metadata],
        ]),
      ).toThrow("must be an object");
    }
  });

  test("decode throws on non-string $types metadata values", () => {
    expect(() =>
      decode([
        ["age", "30"],
        ["$types", JSON.stringify({ age: 30 })],
      ]),
    ).toThrow("must map paths to string type ids");
  });

  test("decode throws on File entries in FormData", () => {
    const formData = new FormData();
    formData.append("name", "Alice");
    formData.append("file", new File(["content"], "test.txt"));
    formData.append("age", "30");
    formData.append("$types", JSON.stringify({ age: "number" }));

    expect(() => decode(formData)).toThrow(/File entries are not supported/);
  });

  test('decode preserves File entries when files option is "preserve"', () => {
    const formData = new FormData();
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    formData.append("name", "Alice");
    formData.append("file", file);
    formData.append("age", "30");
    formData.append("$types", JSON.stringify({ age: "number" }));

    expect(
      decode<{ name: string; file: File; age: number }>(formData, { files: "preserve" }),
    ).toEqual({
      name: "Alice",
      file,
      age: 30,
    });
  });

  test('decode preserves repeated File entries when files option is "preserve"', () => {
    const formData = new FormData();
    const first = new File(["first"], "first.txt");
    const second = new File(["second"], "second.txt");
    formData.append("attachments", first);
    formData.append("attachments", second);

    expect(decode<{ attachments: File[] }>(formData, { files: "preserve" })).toEqual({
      attachments: [first, second],
    });
  });

  test("decode from FormData", () => {
    const original = { name: "Alice", age: 30 };
    const entries = encode(original);

    const formData = new FormData();
    for (const [key, value] of entries) {
      formData.append(key, value);
    }

    expect(decode<typeof original>(formData)).toEqual(original);
  });

  test("decode preserves repeated field names from FormData", () => {
    const formData = new FormData();
    formData.append("tags", "a");
    formData.append("tags", "b");

    expect(
      decode<{
        tags: string[];
      }>(formData),
    ).toEqual({ tags: ["a", "b"] });
  });

  test("decode preserves repeated field names as arrays", () => {
    expect(
      decode<{
        tags: string[];
      }>([
        ["tags", "a"],
        ["tags", "b"],
      ]),
    ).toEqual({ tags: ["a", "b"] });
  });

  test("decode preserves repeated typed field names as arrays", () => {
    expect(
      decode<{
        createdAt: Date[];
      }>([
        ["createdAt", "2024-01-01T00:00:00.000Z"],
        ["createdAt", "2024-06-01T00:00:00.000Z"],
        ["$types", JSON.stringify({ createdAt: "Date" })],
      ]),
    ).toEqual({
      createdAt: [new Date("2024-01-01T00:00:00.000Z"), new Date("2024-06-01T00:00:00.000Z")],
    });
  });

  test("decode rejects nested structural metadata when the decoded shape is incompatible", () => {
    expect(() =>
      decode([
        ["items.name", "x"],
        ["$types", JSON.stringify({ items: "set" })],
      ]),
    ).toThrow('Invalid superformdata metadata: structural type "set" at path "items"');

    expect(() =>
      decode([
        ["lookup.name", "x"],
        ["$types", JSON.stringify({ lookup: "map" })],
      ]),
    ).toThrow('Invalid superformdata metadata: structural type "map" at path "lookup"');
  });

  test("decode rejects root structural metadata when the decoded shape is incompatible", () => {
    expect(() =>
      decode([
        ["items.name", "x"],
        ["$types", JSON.stringify({ "": "set" })],
      ]),
    ).toThrow('Invalid superformdata metadata: structural type "set" at path ""');

    expect(() =>
      decode([
        ["items.name", "x"],
        ["$types", JSON.stringify({ "": "map" })],
      ]),
    ).toThrow('Invalid superformdata metadata: structural type "map" at path ""');
  });

  test("custom typesKey", () => {
    const input = { count: 42, $types: "user data here" };
    const entries = encode(input, { typesKey: "__meta" });

    // $types should appear as a regular data field, __meta carries type info
    const keys = entries.map(([k]) => k);
    expect(keys).toContain("$types");
    expect(keys).toContain("__meta");

    const result = decode(entries, { typesKey: "__meta" }) as Record<string, unknown>;
    expect(result.$types).toBe("user data here");
    expect(result.count).toBe(42);
  });
});

describe("decodeRequest", () => {
  test("application/x-www-form-urlencoded", async () => {
    const input = { name: "Alice", age: 30 };
    const entries = encode(input);
    const body = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(await decodeRequest<typeof input>(request)).toEqual(input);
  });

  test("multipart/form-data", async () => {
    const input = { name: "Alice", active: true };
    const entries = encode(input);

    const formData = new FormData();
    for (const [key, value] of entries) {
      formData.append(key, value);
    }

    const request = new Request("http://localhost", {
      method: "POST",
      body: formData,
    });

    expect(await decodeRequest<typeof input>(request)).toEqual(input);
  });

  test("text/plain", async () => {
    const input = { name: "Alice", count: 42 };
    const entries = encode(input);
    const body = entries.map(([k, v]) => `${k}=${v}`).join("\r\n");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });

    expect(await decodeRequest<typeof input>(request)).toEqual(input);
  });

  test("with custom typesKey", async () => {
    const input = { count: 42 };
    const entries = encode(input, { typesKey: "__meta" });
    const body = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(await decodeRequest<typeof input>(request, { typesKey: "__meta" })).toEqual(input);
  });

  test("throws on unsupported content-type", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    await expect(decodeRequest(request)).rejects.toThrow(/Unsupported content-type/);
  });

  test("throws when content-type header is absent", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "name=Alice",
    });

    await expect(decodeRequest(request)).rejects.toThrow(/Unsupported content-type/);
  });

  test("text/plain with \\n line endings", async () => {
    const input = { name: "Alice", count: 42 };
    const entries = encode(input);
    const body = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });

    expect(await decodeRequest<typeof input>(request)).toEqual(input);
  });
});
