import { describe, expect, test } from "bun:test";

import { decode, decodeRequest, encode, type TypeHandler } from "../src/index.ts";
import { findHandler, getHandler, typeHandlers } from "../src/types.ts";

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const encoded = encode({
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  active: true,
});

type _EncodeReturnIsStable = Assert<Equal<typeof encoded, [string, string][]>>;

const encodedWithFiles = encode(new FormData(), { files: "preserve" });

type _EncodePreserveFilesReturnIncludesFiles = Assert<
  Equal<typeof encodedWithFiles, [string, string | File | Blob][]>
>;

const decoded = decode<{
  createdAt: Date;
  active: boolean;
}>(encoded);

type _DecodeIsGeneric = Assert<
  Equal<
    typeof decoded,
    {
      createdAt: Date;
      active: boolean;
    }
  >
>;

async function assertDecodeRequestGeneric(): Promise<void> {
  const value = await decodeRequest<{
    id: string;
    count: number;
  }>(new Request("https://example.com", { method: "POST", body: "id=abc\ncount=42" }));

  type _DecodeRequestIsGeneric = Assert<
    Equal<
      typeof value,
      {
        id: string;
        count: number;
      }
    >
  >;
}

void assertDecodeRequestGeneric;

interface Money {
  readonly cents: number;
}

const moneyHandler: TypeHandler<Money> = {
  id: "Money",
  test: (value): value is Money =>
    typeof value === "object" &&
    value !== null &&
    "cents" in value &&
    typeof value.cents === "number",
  serialize: (value) => String(value.cents),
  deserialize: (raw) => ({ cents: Number(raw) }),
};

describe("type registry", () => {
  test("findHandler returns undefined for strings", () => {
    expect(findHandler("hello")).toBeUndefined();
  });

  test("built-in handler fast path stays in sync with the canonical handler scan", () => {
    const values = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      -0,
      42n,
      new Date("2024-01-01T00:00:00.000Z"),
      /foo/gi,
      new URL("https://example.com/path"),
      new Error("oops"),
      42,
      3.14,
      true,
      false,
      null,
      "hello",
      {},
      [],
    ];

    for (const value of values) {
      expect(findHandler(value)?.id).toBe(typeHandlers.find((handler) => handler.test(value))?.id);
    }
  });

  test.each([
    ["undefined", undefined, ""],
    ["nan", NaN, "NaN"],
    ["infinity", Infinity, "Infinity"],
    ["-infinity", -Infinity, "-Infinity"],
    ["-0", -0, "-0"],
    ["bigint", 42n, "42"],
    ["Date", new Date("2024-01-01T00:00:00.000Z"), "2024-01-01T00:00:00.000Z"],
    ["RegExp", /foo/gi, "/foo/gi"],
    ["URL", new URL("https://example.com/path"), "https://example.com/path"],
    [
      "Error",
      new Error("oops"),
      JSON.stringify({ __superformdataError: 1, name: "Error", message: "oops" }),
    ],
    ["number", 42, "42"],
    ["number", 3.14, "3.14"],
    ["boolean", true, "true"],
    ["boolean", false, "false"],
    ["null", null, ""],
  ])("%s: serialize → %s", (id, value, expected) => {
    const handler = findHandler(value);
    expect(handler).toBeDefined();
    expect(handler!.id).toBe(id);
    expect(handler!.serialize(value)).toBe(expected);
  });

  test.each([
    ["undefined", "", undefined],
    ["nan", "NaN", NaN],
    ["infinity", "Infinity", Infinity],
    ["-infinity", "-Infinity", -Infinity],
    ["-0", "-0", -0],
    ["bigint", "42", 42n],
    ["Date", "2024-01-01T00:00:00.000Z", new Date("2024-01-01T00:00:00.000Z")],
    ["RegExp", "/foo/gi", /foo/gi],
    ["URL", "https://example.com/path", new URL("https://example.com/path")],
    ["Error", "oops", new Error("oops")],
    ["number", "42", 42],
    ["number", "3.14", 3.14],
    ["boolean", "true", true],
    ["boolean", "false", false],
    ["null", "", null],
  ])("%s: deserialize(%j)", (id, serialized, expected) => {
    const handler = getHandler(id);
    expect(handler).toBeDefined();
    const result = handler!.deserialize(serialized);

    if (id === "nan") {
      expect(Number.isNaN(result)).toBe(true);
    } else if (id === "-0") {
      expect(Object.is(result, -0)).toBe(true);
    } else if (id === "RegExp") {
      expect((result as RegExp).source).toBe((expected as RegExp).source);
      expect((result as RegExp).flags).toBe((expected as RegExp).flags);
    } else if (id === "Error") {
      expect((result as Error).message).toBe((expected as Error).message);
    } else if (id === "Date") {
      expect((result as Date).toISOString()).toBe((expected as Date).toISOString());
    } else if (id === "URL") {
      expect((result as URL).href).toBe((expected as URL).href);
    } else {
      expect(result).toEqual(expected);
    }
  });

  test("Error deserializes structured details", () => {
    const handler = getHandler("Error")!;
    const result = handler.deserialize(
      JSON.stringify({
        __superformdataError: 1,
        name: "TypeError",
        message: "bad input",
        cause: { __superformdataError: 1, name: "Error", message: "root cause" },
      }),
    ) as Error;

    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("bad input");
    expect(result.cause).toBeInstanceOf(Error);
    expect((result.cause as Error).name).toBe("Error");
    expect((result.cause as Error).message).toBe("root cause");
  });

  test("Error deserializes legacy message strings", () => {
    const handler = getHandler("Error")!;
    const result = handler.deserialize("oops") as Error;

    expect(result.name).toBe("Error");
    expect(result.message).toBe("oops");
  });

  test("Error preserves legacy JSON-shaped message strings", () => {
    const handler = getHandler("Error")!;
    const legacyMessage = JSON.stringify({ name: "CustomError", message: "details" });
    const result = handler.deserialize(legacyMessage) as Error;

    expect(result.name).toBe("Error");
    expect(result.message).toBe(legacyMessage);
  });

  test("Error omits undefined cause while serializing", () => {
    const handler = getHandler("Error")!;
    const serialized = handler.serialize(new Error("oops", { cause: undefined }));

    expect(serialized).toBe(
      JSON.stringify({ __superformdataError: 1, name: "Error", message: "oops" }),
    );
  });

  test("Error serializes circular cause as a safe marker", () => {
    const handler = getHandler("Error")!;
    const error = new Error("recursive");
    error.cause = error;

    expect(handler.serialize(error)).toBe(
      JSON.stringify({
        __superformdataError: 1,
        name: "Error",
        message: "recursive",
        cause: {
          __superformdataErrorCause: 1,
          value: "[Circular Error cause]",
        },
      }),
    );
  });

  test("Error serializes non-Error causes without string coercion", () => {
    const handler = getHandler("Error")!;

    expect(handler.serialize(new Error("null cause", { cause: null }))).toBe(
      JSON.stringify({
        __superformdataError: 1,
        name: "Error",
        message: "null cause",
        cause: { __superformdataErrorCause: 1, value: null },
      }),
    );
    expect(handler.serialize(new Error("number cause", { cause: 42 }))).toBe(
      JSON.stringify({
        __superformdataError: 1,
        name: "Error",
        message: "number cause",
        cause: { __superformdataErrorCause: 1, value: 42 },
      }),
    );
    expect(handler.serialize(new Error("object cause", { cause: { code: "E_TEST" } }))).toBe(
      JSON.stringify({
        __superformdataError: 1,
        name: "Error",
        message: "object cause",
        cause: { __superformdataErrorCause: 1, value: { code: "E_TEST" } },
      }),
    );
  });

  test("RegExp with special characters", () => {
    const handler = getHandler("RegExp")!;
    const regex = /^a\/b\d+$/i;
    const serialized = handler.serialize(regex);
    const deserialized = handler.deserialize(serialized) as RegExp;
    expect(deserialized.source).toBe(regex.source);
    expect(deserialized.flags).toBe(regex.flags);
  });

  test("handler priority: NaN before number", () => {
    expect(findHandler(NaN)!.id).toBe("nan");
  });

  test("handler priority: -0 before number", () => {
    expect(findHandler(-0)!.id).toBe("-0");
  });

  test("handler priority: Infinity before number", () => {
    expect(findHandler(Infinity)!.id).toBe("infinity");
  });

  test.each([
    [
      "Date",
      "when",
      "not-a-date",
      'Invalid value for typed field "when": expected Date metadata-compatible value',
    ],
    [
      "number",
      "count",
      "not-a-number",
      'Invalid value for typed field "count": expected number metadata-compatible value',
    ],
    [
      "boolean",
      "active",
      "yes",
      'Invalid value for typed field "active": expected boolean metadata-compatible value',
    ],
    [
      "RegExp",
      "pattern",
      "unterminated",
      'Invalid value for typed field "pattern": expected RegExp metadata-compatible value',
    ],
  ])("decode rejects malformed %s values", (typeId, path, value, message) => {
    expect(() =>
      decode([
        [path, value],
        ["$types", JSON.stringify({ [path]: typeId })],
      ]),
    ).toThrow(message);
  });

  test("custom type handlers round-trip domain values per call", () => {
    const encoded = encode({ price: { cents: 1234 } }, { typeHandlers: [moneyHandler] });

    expect(encoded).toEqual([
      ["price", "1234"],
      ["$types", JSON.stringify({ price: "Money" })],
    ]);
    expect(decode<{ price: Money }>(encoded, { typeHandlers: [moneyHandler] })).toEqual({
      price: { cents: 1234 },
    });
  });

  test("custom type handlers can serialize invalid Dates", () => {
    const invalidDateHandler: TypeHandler<Date> = {
      id: "InvalidDateSentinel",
      test: (value): value is Date => value instanceof Date,
      serialize: (value) => (Number.isNaN(value.getTime()) ? "invalid" : value.toISOString()),
      deserialize: (raw) => (raw === "invalid" ? new Date("not-a-date") : new Date(raw)),
    };

    expect(
      encode({ publishedAt: new Date("not-a-date") }, { typeHandlers: [invalidDateHandler] }),
    ).toEqual([
      ["publishedAt", "invalid"],
      ["$types", JSON.stringify({ publishedAt: "InvalidDateSentinel" })],
    ]);
  });

  test("custom type handlers keep priority over built-in primitive handlers", () => {
    const integerHandler: TypeHandler<number> = {
      id: "Integer",
      test: (value): value is number => Number.isInteger(value),
      serialize: (value) => String(value),
      deserialize: (raw) => Number(raw),
    };

    expect(encode({ count: 42, ratio: 3.14 }, { typeHandlers: [integerHandler] })).toEqual([
      ["count", "42"],
      ["ratio", "3.14"],
      ["$types", JSON.stringify({ count: "Integer", ratio: "number" })],
    ]);
  });

  test("custom type handlers decode explicitly typed entries", () => {
    expect(
      decode<{ price: Money }>(
        [
          ["price", "500"],
          ["$types", JSON.stringify({ price: "Money" })],
        ],
        { typeHandlers: [moneyHandler] },
      ),
    ).toEqual({ price: { cents: 500 } });
  });

  test("decode rejects unregistered custom type ids in metadata", () => {
    expect(() =>
      decode([
        ["price", "500"],
        ["$types", JSON.stringify({ price: "Money" })],
      ]),
    ).toThrow('Unknown type id "Money" for typed field "price"');
  });

  test("decode rejects typoed built-in type ids in metadata", () => {
    expect(() =>
      decode([
        ["createdAt", "2024-01-01T00:00:00.000Z"],
        ["$types", JSON.stringify({ createdAt: "date" })],
      ]),
    ).toThrow('Unknown type id "date" for typed field "createdAt"');
  });

  test("custom type handler ids cannot collide with built-in or structural ids", () => {
    expect(() => encode(1, { typeHandlers: [{ ...moneyHandler, id: "number" }] })).toThrow(
      'Custom type handler id "number" is reserved',
    );
    expect(() => encode(1, { typeHandlers: [{ ...moneyHandler, id: "map" }] })).toThrow(
      'Custom type handler id "map" is reserved',
    );
  });

  test("custom type handler ids must be unique and non-empty", () => {
    expect(() => encode(1, { typeHandlers: [{ ...moneyHandler, id: "" }] })).toThrow(
      "Custom type handler id must not be empty",
    );
    expect(() =>
      encode(1, {
        typeHandlers: [
          { ...moneyHandler, id: "Money" },
          { ...moneyHandler, id: "Money" },
        ],
      }),
    ).toThrow('Duplicate custom type handler id "Money"');
  });
});
