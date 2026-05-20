import { validateKnownTypeIds, validateTypesMetadata } from "./metadata.ts";
import { MAX_SPARSE_ARRAY_LENGTH, appendIndex, appendKey } from "./path.ts";
import { createTypeRegistry, findHandler, type TypeHandlerList } from "./types.ts";

export const DEFAULT_TYPES_KEY = "$types";

export type EncodedEntry = [string, string];
export type PreservedFileEntry = [string, string | File | Blob];
export type FileStrategy = "throw" | "preserve";

export interface EncodeOptions {
  typesKey?: string;
  types?: Record<string, string>;
  typeHandlers?: TypeHandlerList;
  /**
   * File and Blob values are rejected by default so callers do not accidentally
   * treat binary uploads as typed scalar data.
   */
  files?: FileStrategy;
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

export interface EncodePreserveFilesOptions extends EncodeOptions {
  files: "preserve";
}

export function encode<T>(input: T, options: EncodePreserveFilesOptions): PreservedFileEntry[];
export function encode<T>(input: T, options?: EncodeOptions): EncodedEntry[];
export function encode<T>(
  input: T,
  options?: EncodeOptions,
): EncodedEntry[] | PreservedFileEntry[] {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const registry = createTypeRegistry(options?.typeHandlers);
  const fileStrategy = options?.files ?? "throw";

  // HTMLFormElement
  if (typeof HTMLFormElement !== "undefined" && input instanceof HTMLFormElement) {
    return encodeForm(input, typesKey, registry, fileStrategy, options?.types, options?.submitter);
  }

  // FormData
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    return encodeStringEntries(input, typesKey, registry, fileStrategy, options?.types);
  }

  // URLSearchParams
  if (typeof URLSearchParams !== "undefined" && input instanceof URLSearchParams) {
    return encodeStringEntries(input, typesKey, registry, fileStrategy, options?.types);
  }

  // Plain value (existing behavior)
  const entries: PreservedFileEntry[] = [];
  const types: Record<string, string> = {};
  const seen = new Set<unknown>();

  walk(input, "", entries, types, seen, registry, fileStrategy, typesKey);

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

function validateSubmitter(form: HTMLFormElement, submitter?: HTMLElement | null): void {
  if (submitter == null) return;

  if (!isSubmitButton(submitter)) {
    throw new TypeError("The specified element is not a submit button");
  }

  if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
    if (submitter.form === form) return;
  }

  if (typeof DOMException !== "undefined") {
    throw new DOMException(
      "The specified element is not owned by this form element",
      "NotFoundError",
    );
  }

  throw new Error("The specified element is not owned by this form element");
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
  registry: ReturnType<typeof createTypeRegistry>,
  fileStrategy: FileStrategy,
  explicitTypes?: Record<string, string>,
  submitter?: HTMLElement | null,
): EncodedEntry[] | PreservedFileEntry[] {
  validateSubmitter(form, submitter);

  const entries: PreservedFileEntry[] = [];
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
      if (fileStrategy !== "preserve") {
        throw new TypeError(
          `File inputs are not supported by superformdata (field: "${input.name}"). Handle file uploads separately or pass { files: "preserve" }.`,
        );
      }
      for (const file of input.files ?? []) entries.push([input.name, file]);
      continue;
    }

    entries.push([el.name, input.value]);
    if (typeId) types[el.name] = typeId;
  }

  if (Object.keys(types).length > 0) {
    validateKnownTypeIds(types, registry);
    entries.push([typesKey, JSON.stringify(types)]);
  }

  return entries;
}

function encodeStringEntries(
  data: Iterable<[string, string | File | Blob]>,
  typesKey: string,
  registry: ReturnType<typeof createTypeRegistry>,
  fileStrategy: FileStrategy,
  explicitTypes?: Record<string, string>,
): EncodedEntry[] | PreservedFileEntry[] {
  const entries: PreservedFileEntry[] = [];
  let existingTypes: Record<string, string> | undefined;

  for (const [key, value] of data) {
    if (typeof value !== "string") {
      if (fileStrategy !== "preserve") {
        throw new TypeError(
          `File entries are not supported by superformdata (field: "${key}"). Handle file uploads separately or pass { files: "preserve" }.`,
        );
      }
      if (key === typesKey) {
        throw new TypeError(`Invalid superformdata metadata: "${typesKey}" field must be a string`);
      }
      entries.push([key, value]);
      continue;
    }
    if (key === typesKey) {
      if (existingTypes !== undefined) {
        throw new TypeError(`Invalid superformdata metadata: duplicate "${typesKey}" field`);
      }
      try {
        existingTypes = JSON.parse(value);
      } catch {
        throw new TypeError(
          `Invalid superformdata metadata: "${typesKey}" field contains malformed JSON`,
        );
      }
      validateTypesMetadata(existingTypes, typesKey);
      continue;
    }
    entries.push([key, value]);
  }

  const types = { ...existingTypes, ...explicitTypes };

  if (Object.keys(types).length > 0) {
    validateKnownTypeIds(types, registry);
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

function isFileValue(value: unknown): value is File | Blob {
  return (
    (typeof File !== "undefined" && value instanceof File) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

function assertDataPathNotReserved(path: string, typesKey: string): void {
  if (path !== typesKey) return;

  throw new TypeError(
    `Path "${path}" is reserved for superformdata metadata; pass a different typesKey option or rename the root field.`,
  );
}

function walk(
  value: unknown,
  path: string,
  entries: PreservedFileEntry[],
  types: Record<string, string>,
  seen: Set<unknown>,
  registry: ReturnType<typeof createTypeRegistry>,
  fileStrategy: FileStrategy,
  typesKey: string,
): void {
  assertDataPathNotReserved(path, typesKey);

  if (isFileValue(value)) {
    if (fileStrategy !== "preserve") {
      throw new TypeError(
        `File and Blob values are not supported by superformdata at path "${path}". Handle file uploads separately or pass { files: "preserve" }.`,
      );
    }
    entries.push([path, value]);
    return;
  }

  if (value instanceof Set) {
    trackRef(value, path, seen);
    types[path] = "set";
    let i = 0;
    for (const item of value) {
      walk(item, appendIndex(path, i), entries, types, seen, registry, fileStrategy, typesKey);
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
      walk(
        k,
        appendIndex(appendIndex(path, i), 0),
        entries,
        types,
        seen,
        registry,
        fileStrategy,
        typesKey,
      );
      walk(
        v,
        appendIndex(appendIndex(path, i), 1),
        entries,
        types,
        seen,
        registry,
        fileStrategy,
        typesKey,
      );
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
      walk(value[i], appendIndex(path, i), entries, types, seen, registry, fileStrategy, typesKey);
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
      walk(
        value[key],
        appendKey(path, key),
        entries,
        types,
        seen,
        registry,
        fileStrategy,
        typesKey,
      );
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
