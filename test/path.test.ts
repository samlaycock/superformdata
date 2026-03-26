import { describe, expect, test } from "bun:test";
import {
  appendIndex,
  appendKey,
  escapeKey,
  parsePath,
  unescapeKey,
  unflatten,
} from "../src/path.ts";

describe("escapeKey / unescapeKey", () => {
  test("no escaping needed", () => {
    expect(escapeKey("name")).toBe("name");
  });

  test("escapes dots", () => {
    expect(escapeKey("a.b")).toBe("a\\.b");
  });

  test("escapes brackets", () => {
    expect(escapeKey("a[0]")).toBe("a\\[0\\]");
  });

  test("escapes backslashes", () => {
    expect(escapeKey("a\\b")).toBe("a\\\\b");
  });

  test("round-trip", () => {
    const keys = ["simple", "a.b.c", "x[0]", "a\\b", "complex.key[1]\\end"];
    for (const key of keys) {
      expect(unescapeKey(escapeKey(key))).toBe(key);
    }
  });
});

describe("appendKey / appendIndex", () => {
  test("appendKey to empty path", () => {
    expect(appendKey("", "name")).toBe("name");
  });

  test("appendKey to existing path", () => {
    expect(appendKey("user", "name")).toBe("user.name");
  });

  test("appendKey with special chars", () => {
    expect(appendKey("data", "a.b")).toBe("data.a\\.b");
  });

  test("appendIndex to empty path", () => {
    expect(appendIndex("", 0)).toBe("[0]");
  });

  test("appendIndex to existing path", () => {
    expect(appendIndex("items", 0)).toBe("items[0]");
  });
});

describe("parsePath", () => {
  test("empty path", () => {
    expect(parsePath("")).toEqual([]);
  });

  test("simple key", () => {
    expect(parsePath("name")).toEqual(["name"]);
  });

  test("dotted path", () => {
    expect(parsePath("user.address.city")).toEqual(["user", "address", "city"]);
  });

  test("bracket index", () => {
    expect(parsePath("items[0]")).toEqual(["items", 0]);
  });

  test("mixed dot and bracket", () => {
    expect(parsePath("items[0].name")).toEqual(["items", 0, "name"]);
  });

  test("nested brackets", () => {
    expect(parsePath("[0][1]")).toEqual([0, 1]);
  });

  test("escaped dot in key", () => {
    expect(parsePath("a\\.b.c")).toEqual(["a.b", "c"]);
  });

  test("escaped bracket in key", () => {
    expect(parsePath("a\\[0\\].b")).toEqual(["a[0]", "b"]);
  });

  test("deep path", () => {
    expect(parsePath("a.b[0].c[1].d")).toEqual(["a", "b", 0, "c", 1, "d"]);
  });

  test("trailing backslash", () => {
    expect(parsePath("key\\")).toEqual(["key\\"]);
  });

  test("missing closing bracket", () => {
    expect(parsePath("items[0")).toEqual(["items", "[0"]);
  });

  test("empty string key (a..b)", () => {
    expect(parsePath("a..b")).toEqual(["a", "", "b"]);
  });

  test("leading dot (.name)", () => {
    expect(parsePath(".name")).toEqual(["", "name"]);
  });
});

describe("unflatten", () => {
  test("empty entries", () => {
    expect(unflatten([])).toEqual({});
  });

  test("single root value", () => {
    expect(unflatten([["", 42]])).toBe(42);
  });

  test("flat object", () => {
    expect(
      unflatten([
        ["name", "Alice"],
        ["age", 30],
      ]),
    ).toEqual({ name: "Alice", age: 30 });
  });

  test("nested object", () => {
    expect(
      unflatten([
        ["user.name", "Alice"],
        ["user.address.city", "NYC"],
      ]),
    ).toEqual({ user: { name: "Alice", address: { city: "NYC" } } });
  });

  test("array", () => {
    expect(
      unflatten([
        ["[0]", "a"],
        ["[1]", "b"],
      ]),
    ).toEqual(["a", "b"]);
  });

  test("nested array in object", () => {
    expect(
      unflatten([
        ["items[0].name", "x"],
        ["items[1].name", "y"],
      ]),
    ).toEqual({ items: [{ name: "x" }, { name: "y" }] });
  });
});
