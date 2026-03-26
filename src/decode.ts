import { DEFAULT_TYPES_KEY } from "./encode.ts";
import { parsePath, unflatten } from "./path.ts";
import { getHandler } from "./types.ts";

const STRUCTURAL_TYPES = new Set(["set", "map", "array", "object"]);

export interface DecodeOptions {
  typesKey?: string;
}

export function decode(
  data: FormData | Iterable<[string, FormDataEntryValue]>,
  options?: DecodeOptions,
): unknown {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const raw: [string, string][] = [];
  let typesJson: string | undefined;

  for (const [key, value] of data) {
    // Skip File entries
    if (typeof value !== "string") continue;
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
        `Invalid superform metadata: "${typesKey}" field contains malformed JSON`,
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

  // Build a set of all entry paths for O(1) exact-match lookups
  const entryPaths = new Set<string>();
  for (const [p] of deserialized) entryPaths.add(p);

  // Add empty container markers (prefix scan only runs when exact match misses)
  for (const [path, typeId] of structuralPaths) {
    if (entryPaths.has(path)) continue;

    const hasChildren = deserialized.some(
      ([p]) => p.startsWith(path + ".") || p.startsWith(path + "["),
    );
    if (hasChildren) continue;

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

  return result;
}

export async function decodeRequest(request: Request, options?: DecodeOptions): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return decode(await request.formData(), options);
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
    return decode(entries, options);
  }

  return decode(await request.formData(), options);
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
