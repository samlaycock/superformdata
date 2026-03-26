import { describe, expect, test } from "bun:test";
import { decode, decodeRequest, encode } from "../src/index.ts";
import { findHandler, getHandler } from "../src/types.ts";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

const encoded = encode({
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  active: true,
});

type EncodeReturnIsStable = Assert<Equal<typeof encoded, [string, string][]>>;

const decoded = decode<{
  createdAt: Date;
  active: boolean;
}>(encoded);

type DecodeIsGeneric = Assert<
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

  type DecodeRequestIsGeneric = Assert<
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

describe("type registry", () => {
  test("findHandler returns undefined for strings", () => {
    expect(findHandler("hello")).toBeUndefined();
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
    ["Error", new Error("oops"), "oops"],
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
});
