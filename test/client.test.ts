import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { decode } from "../src/decode.ts";
import { encode } from "../src/encode.ts";
import {
  onBigIntChange,
  onBooleanChange,
  onChange,
  onDateChange,
  onNumberChange,
  onURLChange,
} from "../src/client.ts";

beforeEach(() => {
  GlobalRegistrator.register();
});

afterEach(() => {
  return GlobalRegistrator.unregister();
});

function createForm(html: string): HTMLFormElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector("form")!;
}

// --- onChange handlers ---

describe("onChange handlers", () => {
  test("onChange factory sets data-sf-type and updates $types", () => {
    const form = createForm('<input name="count" type="number" />');
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;

    const handler = onChange("number");
    input.value = "42";
    handler({ target: input } as unknown as Event);

    expect(input.dataset.sfType).toBe("number");
    const typesInput = form.querySelector<HTMLInputElement>('input[name="$types"]');
    expect(typesInput).toBeDefined();
    expect(JSON.parse(typesInput!.value)).toEqual({ count: "number" });
  });

  test("onDateChange", () => {
    const form = createForm('<input name="createdAt" type="date" />');
    const input = form.querySelector<HTMLInputElement>('input[name="createdAt"]')!;
    input.value = "2024-01-01";

    onDateChange({ target: input } as unknown as Event);

    expect(input.dataset.sfType).toBe("Date");
    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types.createdAt).toBe("Date");
  });

  test("onNumberChange", () => {
    const form = createForm('<input name="count" type="number" />');
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;
    input.value = "42";

    onNumberChange({ target: input } as unknown as Event);

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types.count).toBe("number");
  });

  test("onBooleanChange sets value from checked state", () => {
    const form = createForm('<input name="active" type="checkbox" />');
    const input = form.querySelector<HTMLInputElement>('input[name="active"]')!;

    input.checked = true;
    onBooleanChange({ target: input } as unknown as Event);
    expect(input.value).toBe("true");

    input.checked = false;
    onBooleanChange({ target: input } as unknown as Event);
    expect(input.value).toBe("false");

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types.active).toBe("boolean");
  });

  test("onBigIntChange", () => {
    const form = createForm('<input name="big" type="text" />');
    const input = form.querySelector<HTMLInputElement>('input[name="big"]')!;
    input.value = "9007199254740993";

    onBigIntChange({ target: input } as unknown as Event);
    expect(input.dataset.sfType).toBe("bigint");
  });

  test("onURLChange", () => {
    const form = createForm('<input name="link" type="url" />');
    const input = form.querySelector<HTMLInputElement>('input[name="link"]')!;
    input.value = "https://example.com";

    onURLChange({ target: input } as unknown as Event);
    expect(input.dataset.sfType).toBe("URL");
  });

  test("multiple handlers on same form accumulate types", () => {
    const form = createForm(
      '<input name="count" type="number" /><input name="date" type="date" />',
    );
    const countInput = form.querySelector<HTMLInputElement>('input[name="count"]')!;
    const dateInput = form.querySelector<HTMLInputElement>('input[name="date"]')!;

    onNumberChange({ target: countInput } as unknown as Event);
    onDateChange({ target: dateInput } as unknown as Event);

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types).toEqual({ count: "number", date: "Date" });
  });

  test("handler ignores inputs without name", () => {
    const form = createForm('<input type="number" />');
    const input = form.querySelector<HTMLInputElement>("input")!;

    onNumberChange({ target: input } as unknown as Event);

    expect(form.querySelector<HTMLInputElement>('input[name="$types"]')).toBeNull();
  });
});

// --- encode(form) ---

describe("encode(form)", () => {
  test("encodes basic text inputs", () => {
    const form = createForm('<input name="name" value="Alice" /><input name="city" value="NYC" />');
    const entries = encode(form);

    expect(entries).toEqual([
      ["name", "Alice"],
      ["city", "NYC"],
    ]);
  });

  test("encodes inputs with data-sf-type", () => {
    const form = createForm(
      '<input name="count" type="number" data-sf-type="number" value="42" />' +
        '<input name="createdAt" type="date" data-sf-type="Date" value="2024-01-01" />',
    );
    const entries = encode(form);
    const typesEntry = entries.find(([k]) => k === "$types");

    expect(typesEntry).toBeDefined();
    const types = JSON.parse(typesEntry![1]);
    expect(types.count).toBe("number");
    expect(types.createdAt).toBe("Date");
  });

  test("encodes checkbox with boolean type", () => {
    const form = createForm(
      '<input name="active" type="checkbox" data-sf-type="boolean" checked />',
    );
    const entries = encode(form);

    expect(entries).toContainEqual(["active", "true"]);
    const types = JSON.parse(entries.find(([k]) => k === "$types")![1]);
    expect(types.active).toBe("boolean");
  });

  test("unchecked boolean checkbox encodes as false", () => {
    const form = createForm('<input name="active" type="checkbox" data-sf-type="boolean" />');
    const entries = encode(form);

    expect(entries).toContainEqual(["active", "false"]);
  });

  test("unchecked checkbox without boolean type is omitted", () => {
    const form = createForm('<input name="agree" type="checkbox" value="yes" />');
    const entries = encode(form);

    expect(entries.find(([k]) => k === "agree")).toBeUndefined();
  });

  test("checked checkbox without boolean type sends value", () => {
    const form = createForm('<input name="agree" type="checkbox" value="yes" checked />');
    const entries = encode(form);

    expect(entries).toContainEqual(["agree", "yes"]);
  });

  test("skips disabled inputs", () => {
    const form = createForm(
      '<input name="name" value="Alice" /><input name="skip" value="x" disabled />',
    );
    const entries = encode(form);

    expect(entries).toEqual([["name", "Alice"]]);
  });

  test("handles radio buttons (only checked)", () => {
    const form = createForm(
      '<input name="color" type="radio" value="red" />' +
        '<input name="color" type="radio" value="blue" checked />',
    );
    const entries = encode(form);

    expect(entries).toEqual([["color", "blue"]]);
  });

  test("skips file inputs", () => {
    const form = createForm('<input name="name" value="Alice" /><input name="file" type="file" />');
    const entries = encode(form);

    expect(entries).toEqual([["name", "Alice"]]);
  });

  test("encodes with custom typesKey", () => {
    const form = createForm('<input name="count" data-sf-type="number" value="42" />');
    const entries = encode(form, { typesKey: "__meta" });

    expect(entries.find(([k]) => k === "__meta")).toBeDefined();
    expect(entries.find(([k]) => k === "$types")).toBeUndefined();
  });

  test("encode(form) round-trips through decode", () => {
    const form = createForm(
      '<input name="name" value="Alice" />' +
        '<input name="count" type="number" data-sf-type="number" value="42" />' +
        '<input name="active" type="checkbox" data-sf-type="boolean" checked />',
    );

    const entries = encode(form);
    const result = decode(entries) as Record<string, unknown>;

    expect(result.name).toBe("Alice");
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });
});

// --- encode(FormData) ---

describe("encode(FormData)", () => {
  test("passes through entries with existing $types", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("count", "42");
    fd.append("$types", JSON.stringify({ count: "number" }));

    const entries = encode(fd);

    expect(entries).toContainEqual(["name", "Alice"]);
    expect(entries).toContainEqual(["count", "42"]);
    const typesEntry = entries.find(([k]) => k === "$types");
    expect(JSON.parse(typesEntry![1]).count).toBe("number");
  });

  test("applies explicit types from options", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("count", "42");

    const entries = encode(fd, { types: { count: "number" } });

    const typesEntry = entries.find(([k]) => k === "$types");
    expect(typesEntry).toBeDefined();
    expect(JSON.parse(typesEntry![1]).count).toBe("number");
  });

  test("explicit types override existing $types", () => {
    const fd = new FormData();
    fd.append("val", "42");
    fd.append("$types", JSON.stringify({ val: "bigint" }));

    const entries = encode(fd, { types: { val: "number" } });

    const types = JSON.parse(entries.find(([k]) => k === "$types")![1]);
    expect(types.val).toBe("number");
  });

  test("FormData without types returns plain entries", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("city", "NYC");

    const entries = encode(fd);

    expect(entries).toEqual([
      ["name", "Alice"],
      ["city", "NYC"],
    ]);
  });

  test("encode(FormData) round-trips through decode", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("count", "42");
    fd.append("$types", JSON.stringify({ count: "number" }));

    const entries = encode(fd);
    const result = decode(entries) as Record<string, unknown>;

    expect(result.name).toBe("Alice");
    expect(result.count).toBe(42);
  });

  test("skips File entries", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("file", new File(["content"], "test.txt"));

    const entries = encode(fd);

    expect(entries).toEqual([["name", "Alice"]]);
  });
});
