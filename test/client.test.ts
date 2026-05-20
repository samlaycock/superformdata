import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { TypeHandler } from "../src/types.ts";

import {
  createChangeHandlers,
  onBigIntChange,
  onBooleanChange,
  onChange,
  onDateChange,
  onNumberChange,
  onURLChange,
} from "../src/client.ts";
import { decode } from "../src/decode.ts";
import { encode } from "../src/encode.ts";

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

const invalidTypeHandler: TypeHandler<unknown> = {
  id: "number",
  test: (value): value is unknown => value !== undefined,
  serialize: String,
  deserialize: (raw) => raw,
};

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

  test("onChange rejects unknown type ids before updating form metadata", () => {
    const form = createForm('<input name="count" type="number" />');
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;
    const handler = onChange("missing");

    expect(() => handler({ target: input } as unknown as Event)).toThrow(
      'Unknown type id "missing" for typed field "count"',
    );
    expect(input.dataset.sfType).toBeUndefined();
    expect(form.querySelector<HTMLInputElement>('input[name="$types"]')).toBeNull();
  });

  test("onChange accepts custom type ids when matching type handlers are provided", () => {
    const customTypeHandler: TypeHandler<string> = {
      id: "Currency",
      test: (value): value is string => typeof value === "string",
      serialize: String,
      deserialize: (raw) => raw,
    };
    const form = createForm('<input name="amount" type="text" />');
    const input = form.querySelector<HTMLInputElement>('input[name="amount"]')!;
    const handler = onChange("Currency", { typeHandlers: [customTypeHandler] });

    handler({ target: input } as unknown as Event);

    expect(input.dataset.sfType).toBe("Currency");
    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types).toEqual({ amount: "Currency" });
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

  test("onNumberChange resets malformed hidden metadata", () => {
    const form = createForm(
      '<input name="count" type="number" /><input type="hidden" name="$types" value="not-json" />',
    );
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;

    expect(() => onNumberChange({ target: input } as unknown as Event)).not.toThrow();

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types).toEqual({ count: "number" });
  });

  test("onNumberChange resets array hidden metadata", () => {
    const form = createForm(
      '<input name="count" type="number" /><input type="hidden" name="$types" value="[1,2,3]" />',
    );
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;

    expect(() => onNumberChange({ target: input } as unknown as Event)).not.toThrow();

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types).toEqual({ count: "number" });
  });

  test("onNumberChange resets primitive hidden metadata", () => {
    const form = createForm(
      '<input name="count" type="number" /><input type="hidden" name="$types" value="42" />',
    );
    const input = form.querySelector<HTMLInputElement>('input[name="count"]')!;

    expect(() => onNumberChange({ target: input } as unknown as Event)).not.toThrow();

    const types = JSON.parse(form.querySelector<HTMLInputElement>('input[name="$types"]')!.value);
    expect(types).toEqual({ count: "number" });
  });

  test("createChangeHandlers respects custom typesKey", () => {
    const form = createForm(
      '<input name="count" type="number" /><input name="active" type="checkbox" /><input name="createdAt" type="date" />',
    );
    const countInput = form.querySelector<HTMLInputElement>('input[name="count"]')!;
    const activeInput = form.querySelector<HTMLInputElement>('input[name="active"]')!;
    const createdAtInput = form.querySelector<HTMLInputElement>('input[name="createdAt"]')!;
    const handlers = createChangeHandlers({ typesKey: "__meta" });

    countInput.value = "42";
    activeInput.checked = true;
    createdAtInput.value = "2024-01-01";

    handlers.onNumberChange({ target: countInput } as unknown as Event);
    handlers.onBooleanChange({ target: activeInput } as unknown as Event);
    handlers.onDateChange({ target: createdAtInput } as unknown as Event);

    expect(form.querySelector<HTMLInputElement>('input[name="$types"]')).toBeNull();
    const typesInput = form.querySelector<HTMLInputElement>('input[name="__meta"]');
    expect(typesInput).toBeDefined();
    expect(JSON.parse(typesInput!.value)).toEqual({
      active: "boolean",
      count: "number",
      createdAt: "Date",
    });
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

  test("rejects unknown data-sf-type values with the field name", () => {
    const form = createForm('<input name="count" data-sf-type="missing" value="42" />');

    expect(() => encode(form)).toThrow('Unknown type id "missing" for typed field "count"');
  });

  test("rejects unknown explicit type values with the field name", () => {
    const form = createForm('<input name="count" value="42" />');

    expect(() => encode(form, { types: { count: "missing" } })).toThrow(
      'Unknown type id "missing" for typed field "count"',
    );
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

  test("skips listed elements that are not successful controls", () => {
    const form = createForm(
      '<fieldset name="group"><input name="x" value="1" /></fieldset>' +
        '<output name="result">42</output>' +
        '<object name="plugin"></object>' +
        '<input name="noop" type="button" value="ignored" />' +
        '<input name="reset" type="reset" value="ignored" />',
    );

    expect(Array.from(form.elements, (element) => element.tagName)).toEqual([
      "FIELDSET",
      "INPUT",
      "OUTPUT",
      "OBJECT",
      "INPUT",
      "INPUT",
    ]);

    const entries = encode(form);

    expect(entries).toEqual([["x", "1"]]);
    expect(entries.every(([, value]) => typeof value === "string")).toBe(true);
  });

  test("skips controls in disabled fieldsets except controls in the first legend", () => {
    const form = createForm(
      "<fieldset disabled>" +
        '<legend><input name="legend" value="included" /></legend>' +
        '<input name="secret" value="x" />' +
        '<legend><input name="secondLegend" value="excluded" /></legend>' +
        "</fieldset>" +
        '<input name="name" value="Alice" />',
    );
    const entries = encode(form);

    expect(entries).toEqual([
      ["legend", "included"],
      ["name", "Alice"],
    ]);
  });

  test("skips controls in nested fieldsets inside disabled fieldset bodies", () => {
    const form = createForm(
      "<fieldset disabled>" +
        '<legend><input name="outerLegend" value="included" /></legend>' +
        "<fieldset>" +
        '<legend><input name="innerLegend" value="excluded" /></legend>' +
        '<input name="innerBody" value="excluded" />' +
        "</fieldset>" +
        "</fieldset>" +
        '<input name="name" value="Alice" />',
    );
    const entries = encode(form);

    expect(entries).toEqual([
      ["outerLegend", "included"],
      ["name", "Alice"],
    ]);
  });

  test("preserves first-legend exceptions across nested disabled fieldsets", () => {
    const form = createForm(
      "<fieldset disabled>" +
        "<legend>" +
        '<input name="outerLegend" value="included" />' +
        "<fieldset disabled>" +
        '<legend><input name="innerLegend" value="included" /></legend>' +
        '<input name="innerBody" value="excluded" />' +
        "</fieldset>" +
        "</legend>" +
        "</fieldset>",
    );
    const entries = encode(form);

    expect(entries).toEqual([
      ["outerLegend", "included"],
      ["innerLegend", "included"],
    ]);
  });

  test("handles radio buttons (only checked)", () => {
    const form = createForm(
      '<input name="color" type="radio" value="red" />' +
        '<input name="color" type="radio" value="blue" checked />',
    );
    const entries = encode(form);

    expect(entries).toEqual([["color", "blue"]]);
  });

  test("throws on file inputs", () => {
    const form = createForm('<input name="name" value="Alice" /><input name="file" type="file" />');

    expect(() => encode(form)).toThrow(/File inputs are not supported/);
  });

  test('preserves file inputs when files option is "preserve"', () => {
    const form = createForm('<input name="name" value="Alice" /><input name="file" type="file" />');
    const input = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["content"], "test.txt", { type: "text/plain" });

    Object.defineProperty(input, "files", {
      value: [file],
    });

    const entries = encode(form, { files: "preserve" });

    expect(entries).toEqual([
      ["name", "Alice"],
      ["file", file],
    ]);
  });

  test("encodes with custom typesKey", () => {
    const form = createForm('<input name="count" data-sf-type="number" value="42" />');
    const entries = encode(form, { typesKey: "__meta" });

    expect(entries.find(([k]) => k === "__meta")).toBeDefined();
    expect(entries.find(([k]) => k === "$types")).toBeUndefined();
  });

  test("validates custom type handlers for form inputs", () => {
    const form = createForm('<input name="count" value="42" />');

    expect(() => encode(form, { typeHandlers: [invalidTypeHandler] })).toThrow(
      'Custom type handler id "number" is reserved',
    );
  });

  test("excludes button elements by default (no submitter)", () => {
    const form = createForm(
      '<input name="title" value="hello" /><button name="action" value="save">Save</button>',
    );
    const entries = encode(form);

    expect(entries).toEqual([["title", "hello"]]);
  });

  test("includes button when passed as submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><button name="action" value="save">Save</button>',
    );
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const entries = encode(form, { submitter: button });

    expect(entries).toEqual([
      ["title", "hello"],
      ["action", "save"],
    ]);
  });

  test("rejects button[type=button] passed as submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><button name="action" type="button" value="click">Click</button>',
    );
    const button = form.querySelector<HTMLButtonElement>("button")!;

    expect(() => encode(form, { submitter: button })).toThrow(TypeError);
  });

  test("rejects non-submit input passed as submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><input name="notSubmit" value="x" />',
    );
    const input = form.querySelector<HTMLInputElement>('input[name="notSubmit"]')!;

    expect(() => encode(form, { submitter: input })).toThrow(TypeError);
  });

  test("rejects submit buttons not owned by the form", () => {
    document.body.innerHTML =
      '<form id="target"><input name="title" value="hello" /></form>' +
      '<form id="other"><button name="action" value="save">Save</button></form>';
    const form = document.querySelector<HTMLFormElement>("#target")!;
    const button = document.querySelector<HTMLButtonElement>("#other button")!;

    expect(() => encode(form, { submitter: button })).toThrow();
  });

  test("excludes input[type=submit] without submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><input name="sub" type="submit" value="Send" />',
    );
    const entries = encode(form);

    expect(entries).toEqual([["title", "hello"]]);
  });

  test("includes input[type=submit] when passed as submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><input name="sub" type="submit" value="Send" />',
    );
    const submitInput = form.querySelector<HTMLInputElement>('input[type="submit"]')!;
    const entries = encode(form, { submitter: submitInput });

    expect(entries).toEqual([
      ["title", "hello"],
      ["sub", "Send"],
    ]);
  });

  test("includes input[type=image] when passed as submitter (encodes name+value, not coordinates)", () => {
    const form = createForm(
      '<input name="title" value="hello" /><input name="img" type="image" value="go" />',
    );
    const imageInput = form.querySelector<HTMLInputElement>('input[type="image"]')!;
    const entries = encode(form, { submitter: imageInput });

    expect(entries).toContainEqual(["title", "hello"]);
    expect(entries).toContainEqual(["img", "go"]);
  });

  test("excludes input[type=image] without submitter", () => {
    const form = createForm(
      '<input name="title" value="hello" /><input name="img" type="image" value="go" />',
    );
    const entries = encode(form);

    expect(entries).toEqual([["title", "hello"]]);
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

  test("rejects unknown existing $types values with the field name", () => {
    const fd = new FormData();
    fd.append("count", "42");
    fd.append("$types", JSON.stringify({ count: "missing" }));

    expect(() => encode(fd)).toThrow('Unknown type id "missing" for typed field "count"');
  });

  test("rejects unknown explicit types with the field name", () => {
    const fd = new FormData();
    fd.append("count", "42");

    expect(() => encode(fd, { types: { count: "missing" } })).toThrow(
      'Unknown type id "missing" for typed field "count"',
    );
  });

  test("explicit types override existing $types", () => {
    const fd = new FormData();
    fd.append("val", "42");
    fd.append("$types", JSON.stringify({ val: "bigint" }));

    const entries = encode(fd, { types: { val: "number" } });

    const types = JSON.parse(entries.find(([k]) => k === "$types")![1]);
    expect(types.val).toBe("number");
  });

  test("throws on duplicate existing $types entries", () => {
    const fd = new FormData();
    fd.append("count", "42");
    fd.append("$types", JSON.stringify({ count: "number" }));
    fd.append("$types", JSON.stringify({ count: "bigint" }));

    expect(() => encode(fd)).toThrow('Invalid superformdata metadata: duplicate "$types" field');
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

  test("validates custom type handlers for FormData inputs", () => {
    const fd = new FormData();
    fd.append("count", "42");

    expect(() => encode(fd, { typeHandlers: [invalidTypeHandler] })).toThrow(
      'Custom type handler id "number" is reserved',
    );
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

  test("throws on File entries", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("file", new File(["content"], "test.txt"));

    expect(() => encode(fd)).toThrow(/File entries are not supported/);
  });

  test('preserves File entries when files option is "preserve"', () => {
    const fd = new FormData();
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    fd.append("name", "Alice");
    fd.append("file", file);
    fd.append("count", "42");

    const entries = encode(fd, { files: "preserve", types: { count: "number" } });

    expect(entries).toContainEqual(["name", "Alice"]);
    expect(entries).toContainEqual(["file", file]);
    expect(entries).toContainEqual(["count", "42"]);
    expect(JSON.parse(entries.find(([key]) => key === "$types")![1] as string)).toEqual({
      count: "number",
    });
  });

  test("throws when preserved File entry uses the metadata key", () => {
    const fd = new FormData();
    fd.append("$types", new File(["content"], "metadata.txt"));

    expect(() => encode(fd, { files: "preserve" })).toThrow(
      'Invalid superformdata metadata: "$types" field must be a string',
    );
  });
});
