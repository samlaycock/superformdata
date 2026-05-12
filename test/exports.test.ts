import { describe, expect, test } from "bun:test";

import packageJson from "../package.json" with { type: "json" };

describe("package exports", () => {
  test("declares root, core, and client subpaths", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([".", "./client", "./core"]);
  });
});
