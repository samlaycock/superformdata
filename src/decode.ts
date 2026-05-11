import { DEFAULT_TYPES_KEY } from "./encode.ts";
import {
  MAX_SPARSE_ARRAY_LENGTH,
  appendIndex,
  appendKey,
  parsePath,
  unflattenParsed,
  type ParsedPathEntry,
  type PathSegment,
} from "./path.ts";
import {
  createTypeRegistry,
  getHandler,
  type TypeHandlerList,
  type TypeRegistry,
} from "./types.ts";

const STRUCTURAL_TYPES = new Set(["set", "map", "array", "object"]);

interface StructuralPath {
  readonly path: string;
  readonly segments: readonly PathSegment[];
  readonly typeId: string;
}

export interface DecodeOptions {
  typesKey?: string;
  typeHandlers?: TypeHandlerList;
}

export function decode<T = unknown>(
  data: FormData | Iterable<[string, FormDataEntryValue]>,
  options?: DecodeOptions,
): T {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const raw: [string, string][] = [];
  let typesJson: string | undefined;
  const registry = createTypeRegistry(options?.typeHandlers);

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
    validateTypesMetadata(types, typesKey);
    validateKnownTypeIds(types, registry);
  }

  // Collect structural type paths and empty container paths
  const structuralPaths: StructuralPath[] = [];
  for (const [path, typeId] of Object.entries(types)) {
    if (isStructuralType(typeId)) {
      structuralPaths.push({ path, segments: parsePath(path), typeId });
    }
  }

  // Deserialize leaf values
  const deserialized: ParsedPathEntry[] = [];
  for (const [path, value] of raw) {
    const typeId = types[path];
    const segments = parsePath(path);
    if (typeId && !isStructuralType(typeId)) {
      const handler = getHandler(typeId, registry)!;
      try {
        deserialized.push({ path, segments, value: handler.deserialize(value) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : `could not deserialize ${typeId}`;
        throw new TypeError(`Invalid value for typed field "${path}": ${reason}`);
      }
      continue;
    }
    deserialized.push({ path, segments, value });
  }

  // Build lookup sets once so empty-container reconstruction does not scan
  // all decoded entries for every structural metadata path.
  const entryPaths = new Set<string>();
  for (const entry of deserialized) entryPaths.add(entry.path);
  const parentPaths = buildParentPathSet(deserialized);

  // Add empty container markers
  for (const { path, segments, typeId } of structuralPaths) {
    if (entryPaths.has(path)) continue;
    if (parentPaths.has(path)) continue;

    const sparseArrayLength = parseSparseArrayTypeId(typeId);

    if (typeId === "set") {
      deserialized.push({ path, segments, value: new Set() });
    } else if (typeId === "map") {
      deserialized.push({ path, segments, value: new Map() });
    } else if (typeId === "array" || sparseArrayLength !== undefined) {
      deserialized.push({
        path,
        segments,
        value: sparseArrayLength === undefined ? [] : createSparseArray(sparseArrayLength),
      });
    } else if (typeId === "object") {
      deserialized.push({ path, segments, value: {} });
    }
  }

  // Unflatten into nested structure
  let result = unflattenParsed(deserialized);

  const sortedSparseArrays = structuralPaths
    .map(({ path, segments, typeId }): [string, readonly PathSegment[], number] | undefined => {
      const length = parseSparseArrayTypeId(typeId);
      return length === undefined ? undefined : [path, segments, length];
    })
    .filter((item): item is [string, readonly PathSegment[], number] => item !== undefined)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [path, segments, length] of sortedSparseArrays) {
    if (path === "") {
      if (Array.isArray(result)) result.length = length;
    } else {
      resizeArray(result, segments, length);
    }
  }

  // Post-process structural types (deepest-first)
  const sortedStructural = structuralPaths
    .filter(({ typeId }) => typeId === "set" || typeId === "map")
    .sort((a, b) => b.path.length - a.path.length);

  for (const { path, segments, typeId } of sortedStructural) {
    if (path === "") {
      // Top-level structural type
      if (typeId === "set" && Array.isArray(result)) {
        result = new Set(result);
      } else if (typeId === "map" && Array.isArray(result)) {
        result = new Map(result as [unknown, unknown][]);
      } else if (!isConvertedStructuralValue(result, typeId)) {
        throwStructuralMismatch(path, typeId);
      }
    } else {
      convertStructural(result, path, segments, typeId);
    }
  }

  return result as T;
}

function validateTypesMetadata(
  types: unknown,
  typesKey: string,
): asserts types is Record<string, string> {
  if (types === null || typeof types !== "object" || Array.isArray(types)) {
    throw new TypeError(`Invalid superformdata metadata: "${typesKey}" field must be an object`);
  }

  for (const [path, typeId] of Object.entries(types)) {
    if (typeof typeId !== "string") {
      throw new TypeError(
        `Invalid superformdata metadata: "${typesKey}" field must map paths to string type ids (path: "${path}")`,
      );
    }
  }
}

function validateKnownTypeIds(types: Record<string, string>, registry: TypeRegistry): void {
  for (const [path, typeId] of Object.entries(types)) {
    if (isStructuralType(typeId)) continue;
    if (getHandler(typeId, registry)) continue;

    throw new TypeError(`Unknown type id "${typeId}" for typed field "${path}"`);
  }
}

function isStructuralType(typeId: string): boolean {
  return STRUCTURAL_TYPES.has(typeId) || parseSparseArrayTypeId(typeId) !== undefined;
}

function parseSparseArrayTypeId(typeId: string): number | undefined {
  if (!typeId.startsWith("array:")) return undefined;

  const rawLength = typeId.slice("array:".length);
  if (!/^(?:0|[1-9]\d*)$/.test(rawLength)) return undefined;

  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_SPARSE_ARRAY_LENGTH) return undefined;

  return length;
}

function createSparseArray(length: number): unknown[] {
  const array: unknown[] = [];
  array.length = length;
  return array;
}

function buildParentPathSet(entries: readonly ParsedPathEntry[]): Set<string> {
  const parentPaths = new Set<string>();

  for (const { segments } of entries) {
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

function throwStructuralMismatch(path: string, typeId: string): never {
  throw new TypeError(
    `Invalid superformdata metadata: structural type "${typeId}" at path "${path}" does not match decoded value shape`,
  );
}

function convertStructural(
  root: unknown,
  path: string,
  segments: readonly PathSegment[],
  typeId: string,
): void {
  if (segments.length === 0) {
    // Can't convert root in-place; this shouldn't happen for structural types
    // at root level since unflatten returns the array/object directly
    return;
  }

  let current: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]!] as Record<string | number, unknown>;
    if (current === null || current === undefined) throwStructuralMismatch(path, typeId);
  }

  const lastSeg = segments[segments.length - 1]!;
  const value = current[lastSeg];

  if (isConvertedStructuralValue(value, typeId)) {
    // Already converted (empty container case)
    return;
  }

  if (typeId === "set" && Array.isArray(value)) {
    current[lastSeg] = new Set(value);
  } else if (typeId === "map" && Array.isArray(value)) {
    current[lastSeg] = new Map(value as [unknown, unknown][]);
  } else {
    throwStructuralMismatch(path, typeId);
  }
}

function isConvertedStructuralValue(value: unknown, typeId: string): boolean {
  return (typeId === "set" && value instanceof Set) || (typeId === "map" && value instanceof Map);
}

function resizeArray(root: unknown, segments: readonly PathSegment[], length: number): void {
  if (segments.length === 0) return;

  let current: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]!] as Record<string | number, unknown>;
    if (current === undefined) return;
  }

  const lastSeg = segments[segments.length - 1]!;
  const value = current[lastSeg];
  if (Array.isArray(value)) value.length = length;
}
