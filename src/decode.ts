import { DEFAULT_TYPES_KEY } from "./encode.ts";
import { appendIndex, appendKey, parsePath, unflatten } from "./path.ts";
import { getHandler } from "./types.ts";

const STRUCTURAL_TYPES = new Set(["set", "map", "array", "object"]);

export interface DecodeOptions {
  typesKey?: string;
}

export function decode<T = unknown>(
  data: FormData | Iterable<[string, FormDataEntryValue]>,
  options?: DecodeOptions,
): T {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const raw: [string, string][] = [];
  let typesJson: string | undefined;

  for (const [key, value] of data) {
    if (typeof value !== "string") {
      throw new TypeError(
        `File entries are not supported by superformdata (field: "${key}"). Handle file uploads separately.`,
      );
    }
    if (key === typesKey) {
      typesJson = value;
    } else {
      raw.push([key, value]);
    }
  }

  let types: Record<string, string> = {};
  if (typesJson) {
    try {
      types = JSON.parse(typesJson);
    } catch {
      throw new TypeError(
        `Invalid superformdata metadata: "${typesKey}" field contains malformed JSON`,
      );
    }
  }

  // Collect structural type paths and empty container paths
  const structuralPaths: [string, string][] = [];
  for (const [path, typeId] of Object.entries(types)) {
    if (STRUCTURAL_TYPES.has(typeId)) {
      structuralPaths.push([path, typeId]);
    }
  }

  // Deserialize leaf values
  const deserialized: [string, unknown][] = [];
  for (const [path, value] of raw) {
    const typeId = types[path];
    if (typeId && !STRUCTURAL_TYPES.has(typeId)) {
      const handler = getHandler(typeId);
      if (handler) {
        deserialized.push([path, handler.deserialize(value)]);
        continue;
      }
    }
    deserialized.push([path, value]);
  }

  // Build lookup sets once so empty-container reconstruction does not scan
  // all decoded entries for every structural metadata path.
  const entryPaths = new Set<string>();
  for (const [p] of deserialized) entryPaths.add(p);
  const parentPaths = buildParentPathSet(entryPaths);

  // Add empty container markers
  for (const [path, typeId] of structuralPaths) {
    if (entryPaths.has(path)) continue;
    if (parentPaths.has(path)) continue;

    if (typeId === "set") {
      deserialized.push([path, new Set()]);
    } else if (typeId === "map") {
      deserialized.push([path, new Map()]);
    } else if (typeId === "array") {
      deserialized.push([path, []]);
    } else if (typeId === "object") {
      deserialized.push([path, {}]);
    }
  }

  // Unflatten into nested structure
  let result = unflatten(deserialized);

  // Post-process structural types (deepest-first)
  const sortedStructural = structuralPaths
    .filter(([, t]) => t === "set" || t === "map")
    .sort((a, b) => b[0].length - a[0].length);

  for (const [path, typeId] of sortedStructural) {
    if (path === "") {
      // Top-level structural type
      if (typeId === "set" && Array.isArray(result)) {
        result = new Set(result);
      } else if (typeId === "map" && Array.isArray(result)) {
        result = new Map(result as [unknown, unknown][]);
      }
    } else {
      convertStructural(result, path, typeId);
    }
  }

  return result as T;
}

function buildParentPathSet(paths: Set<string>): Set<string> {
  const parentPaths = new Set<string>();

  for (const path of paths) {
    const segments = parsePath(path);
    if (segments.length === 0) continue;

    parentPaths.add("");

    let parentPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]!;
      parentPath =
        typeof segment === "number"
          ? appendIndex(parentPath, segment)
          : appendKey(parentPath, segment);
      parentPaths.add(parentPath);
    }
  }

  return parentPaths;
}

export async function decodeRequest<T = unknown>(
  request: Request,
  options?: DecodeOptions,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return decode<T>(await request.formData(), options);
  }

  if (contentType.includes("text/plain")) {
    const text = await request.text();
    const entries: [string, string][] = text
      .split(/\r?\n/)
      .filter((line) => line !== "")
      .map((line) => {
        const eq = line.indexOf("=");
        if (eq === -1) return [line, ""];
        return [line.slice(0, eq), line.slice(eq + 1)];
      });
    return decode<T>(entries, options);
  }

  throw new TypeError(
    `Unsupported content-type: "${contentType}". decodeRequest() only supports multipart/form-data, application/x-www-form-urlencoded, and text/plain.`,
  );
}

function convertStructural(root: unknown, path: string, typeId: string): void {
  const segments = parsePath(path);

  if (segments.length === 0) {
    // Can't convert root in-place; this shouldn't happen for structural types
    // at root level since unflatten returns the array/object directly
    return;
  }

  let current: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]!] as Record<string | number, unknown>;
    if (current === undefined) return;
  }

  const lastSeg = segments[segments.length - 1]!;
  const value = current[lastSeg];

  if (value instanceof Set || value instanceof Map) {
    // Already converted (empty container case)
    return;
  }

  if (typeId === "set" && Array.isArray(value)) {
    current[lastSeg] = new Set(value);
  } else if (typeId === "map" && Array.isArray(value)) {
    current[lastSeg] = new Map(value as [unknown, unknown][]);
  }
}
