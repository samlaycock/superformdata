import { MAX_SPARSE_ARRAY_LENGTH, appendIndex, appendKey } from "./path.ts";
import { createTypeRegistry, findHandler, type TypeHandlerList } from "./types.ts";

export const DEFAULT_TYPES_KEY = "$types";

export interface EncodeOptions {
  typesKey?: string;
  types?: Record<string, string>;
  typeHandlers?: TypeHandlerList;
  /**
   * The element used to submit the form, mirroring `new FormData(form, submitter)`.
   * Only submit buttons (`<button>`, `input[type=submit]`) that equal this element
   * are included in the encoded output.
   *
   * Note: `input[type=image]` is recognised as a submit button and included when it
   * equals the submitter, but the encoded value is `[name, value]` rather than the
   * `[name.x, clickX]` / `[name.y, clickY]` pairs a real browser submission produces,
   * because the originating click coordinates are not available here.
   */
  submitter?: HTMLElement | null;
}

export function encode<T>(input: T, options?: EncodeOptions): [string, string][] {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const registry = createTypeRegistry(options?.typeHandlers);

  // HTMLFormElement
  if (typeof HTMLFormElement !== "undefined" && input instanceof HTMLFormElement) {
    return encodeForm(input, typesKey, options?.types, options?.submitter);
  }

  // FormData
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    return encodeStringEntries(input, typesKey, options?.types);
  }

  // URLSearchParams
  if (typeof URLSearchParams !== "undefined" && input instanceof URLSearchParams) {
    return encodeStringEntries(input, typesKey, options?.types);
  }

  // Plain value (existing behavior)
  const entries: [string, string][] = [];
  const types: Record<string, string> = {};
  const seen = new Set<unknown>();

  walk(input, "", entries, types, seen, registry);

  if (Object.keys(types).length > 0) {
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function isSubmitButton(el: Element): boolean {
  if (el instanceof HTMLButtonElement) {
    return el.type === "submit";
  }
  if (el instanceof HTMLInputElement) {
    return el.type === "submit" || el.type === "image";
  }
  return false;
}

function isSubmittableFormControl(
  element: Element,
): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLButtonElement
  );
}

function isInsideFirstLegend(element: Element, fieldset: HTMLFieldSetElement): boolean {
  const firstLegend = fieldset.querySelector(":scope > legend");
  return firstLegend?.contains(element) ?? false;
}

function isDisabledByFieldset(element: Element): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (!(parent instanceof HTMLFieldSetElement) || !parent.disabled) continue;
    const fieldset = parent;
    if (!isInsideFirstLegend(element, fieldset)) return true;
  }

  return false;
}

function encodeForm(
  form: HTMLFormElement,
  typesKey: string,
  explicitTypes?: Record<string, string>,
  submitter?: HTMLElement | null,
): [string, string][] {
  const entries: [string, string][] = [];
  const types: Record<string, string> = { ...explicitTypes };

  for (const element of form.elements) {
    if (!isSubmittableFormControl(element)) continue;
    const el = element;

    if (!el.name || el.disabled || isDisabledByFieldset(el)) continue;
    if (el.name === typesKey) continue;

    // Buttons are only successful controls when they are the submitter
    if (el instanceof HTMLButtonElement) {
      if (isSubmitButton(el) && el === submitter) {
        entries.push([el.name, el.value]);
      }
      continue;
    }

    // input[type=submit] and input[type=image] follow the same rule
    if (el instanceof HTMLInputElement && isSubmitButton(el)) {
      if (el === submitter) {
        entries.push([el.name, el.value]);
      }
      continue;
    }

    if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "reset")) {
      continue;
    }

    const typeId = (el as HTMLInputElement).dataset?.sfType ?? types[el.name];

    if (el instanceof HTMLSelectElement && el.multiple) {
      for (const opt of el.selectedOptions) {
        entries.push([el.name, opt.value]);
      }
      if (typeId) types[el.name] = typeId;
      continue;
    }

    const input = el as HTMLInputElement;

    if (input.type === "checkbox") {
      if (typeId === "boolean") {
        entries.push([input.name, String(input.checked)]);
        types[input.name] = "boolean";
      } else if (input.checked) {
        entries.push([input.name, input.value || "on"]);
      }
      continue;
    }

    if (input.type === "radio") {
      if (!input.checked) continue;
      entries.push([input.name, input.value]);
      if (typeId) types[input.name] = typeId;
      continue;
    }

    if (input.type === "file") {
      throw new TypeError(
        `File inputs are not supported by superformdata (field: "${input.name}"). Handle file uploads separately.`,
      );
    }

    entries.push([el.name, input.value]);
    if (typeId) types[el.name] = typeId;
  }

  if (Object.keys(types).length > 0) {
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function encodeStringEntries(
  data: Iterable<[string, string | File]>,
  typesKey: string,
  explicitTypes?: Record<string, string>,
): [string, string][] {
  const entries: [string, string][] = [];
  let existingTypes: Record<string, string> | undefined;

  for (const [key, value] of data) {
    if (typeof value !== "string") {
      throw new TypeError(
        `File entries are not supported by superformdata (field: "${key}"). Handle file uploads separately.`,
      );
    }
    if (key === typesKey) {
      try {
        existingTypes = JSON.parse(value);
      } catch {
        // Malformed $types — ignore and treat entries as strings
      }
      continue;
    }
    entries.push([key, value]);
  }

  const types = { ...existingTypes, ...explicitTypes };

  if (Object.keys(types).length > 0) {
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function trackRef(value: unknown, path: string, seen: Set<unknown>): void {
  if (seen.has(value)) {
    throw new TypeError(`Circular reference detected at path "${path}"`);
  }
  seen.add(value);
}

function walk(
  value: unknown,
  path: string,
  entries: [string, string][],
  types: Record<string, string>,
  seen: Set<unknown>,
  registry: ReturnType<typeof createTypeRegistry>,
): void {
  if (value instanceof Set) {
    trackRef(value, path, seen);
    types[path] = "set";
    let i = 0;
    for (const item of value) {
      walk(item, appendIndex(path, i), entries, types, seen, registry);
      i++;
    }
    seen.delete(value);
    return;
  }

  if (value instanceof Map) {
    trackRef(value, path, seen);
    types[path] = "map";
    let i = 0;
    for (const [k, v] of value) {
      walk(k, appendIndex(appendIndex(path, i), 0), entries, types, seen, registry);
      walk(v, appendIndex(appendIndex(path, i), 1), entries, types, seen, registry);
      i++;
    }
    seen.delete(value);
    return;
  }

  if (Array.isArray(value)) {
    trackRef(value, path, seen);
    if (value.length === 0) {
      types[path] = "array";
      seen.delete(value);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) {
        if (value.length > MAX_SPARSE_ARRAY_LENGTH) {
          throw new TypeError(`Sparse array length too large at path "${path}": ${value.length}`);
        }
        types[path] = `array:${value.length}`;
        continue;
      }
      walk(value[i], appendIndex(path, i), entries, types, seen, registry);
    }
    seen.delete(value);
    return;
  }

  const handler = findHandler(value, registry);
  if (handler) {
    if (handler.id === "Date" && Number.isNaN((value as Date).getTime())) {
      throw new TypeError(`Invalid Date at path "${path}"`);
    }
    entries.push([path, handler.serialize(value)]);
    types[path] = handler.id;
    return;
  }

  if (isPlainObject(value)) {
    trackRef(value, path, seen);
    const keys = Object.keys(value);
    if (keys.length === 0) {
      types[path] = "object";
      seen.delete(value);
      return;
    }
    for (const key of keys) {
      walk(value[key], appendKey(path, key), entries, types, seen, registry);
    }
    seen.delete(value);
    return;
  }

  // Leaf value
  if (typeof value === "string") {
    entries.push([path, value]);
  } else {
    const type = typeof value === "object" ? (value as object).constructor.name : typeof value;
    throw new TypeError(`Unsupported type "${type}" at path "${path}"`);
  }
}
