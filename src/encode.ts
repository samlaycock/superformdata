import { appendIndex, appendKey } from "./path.ts";
import { findHandler } from "./types.ts";

export const DEFAULT_TYPES_KEY = "$types";

export interface EncodeOptions {
  typesKey?: string;
  types?: Record<string, string>;
}

export function encode(input: unknown, options?: EncodeOptions): [string, string][] {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;

  // HTMLFormElement
  if (typeof HTMLFormElement !== "undefined" && input instanceof HTMLFormElement) {
    return encodeForm(input, typesKey, options?.types);
  }

  // FormData
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    return encodeFormData(input, typesKey, options?.types);
  }

  // Plain value (existing behavior)
  const entries: [string, string][] = [];
  const types: Record<string, string> = {};
  const seen = new Set<unknown>();

  walk(input, "", entries, types, seen);

  if (Object.keys(types).length > 0) {
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function encodeForm(
  form: HTMLFormElement,
  typesKey: string,
  explicitTypes?: Record<string, string>,
): [string, string][] {
  const entries: [string, string][] = [];
  const types: Record<string, string> = { ...explicitTypes };

  for (const element of form.elements) {
    const el = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!el.name || el.disabled) continue;
    if (el.name === typesKey) continue;

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

    // Skip file inputs
    if (input.type === "file") continue;

    entries.push([el.name, input.value]);
    if (typeId) types[el.name] = typeId;
  }

  if (Object.keys(types).length > 0) {
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function encodeFormData(
  data: FormData,
  typesKey: string,
  explicitTypes?: Record<string, string>,
): [string, string][] {
  const entries: [string, string][] = [];
  let existingTypes: Record<string, string> | undefined;

  for (const [key, value] of data) {
    if (typeof value !== "string") continue;
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
): void {
  if (value instanceof Set) {
    trackRef(value, path, seen);
    types[path] = "set";
    let i = 0;
    for (const item of value) {
      walk(item, appendIndex(path, i), entries, types, seen);
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
      walk(k, appendIndex(appendIndex(path, i), 0), entries, types, seen);
      walk(v, appendIndex(appendIndex(path, i), 1), entries, types, seen);
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
      walk(value[i], appendIndex(path, i), entries, types, seen);
    }
    seen.delete(value);
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
      walk(value[key], appendKey(path, key), entries, types, seen);
    }
    seen.delete(value);
    return;
  }

  // Leaf value
  const handler = findHandler(value);
  if (handler) {
    entries.push([path, handler.serialize(value)]);
    types[path] = handler.id;
  } else if (typeof value === "string") {
    entries.push([path, value]);
  } else {
    const type = typeof value === "object" ? (value as object).constructor.name : typeof value;
    throw new TypeError(`Unsupported type "${type}" at path "${path}"`);
  }
}
