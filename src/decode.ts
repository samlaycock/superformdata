import { DEFAULT_TYPES_KEY } from "./encode.ts";
import {
  isStructuralType,
  parseSparseArrayTypeId,
  validateKnownTypeIds,
  validateTypesMetadata,
} from "./metadata.ts";
import {
  appendIndex,
  appendKey,
  parsePath,
  parsePathEntry,
  unflattenParsed,
  type ParsedPathEntry,
  type PathSegment,
} from "./path.ts";
import { createTypeRegistry, getHandler, type TypeHandlerList } from "./types.ts";

interface StructuralPath {
  readonly path: string;
  readonly typeId: string;
}

export interface DecodeOptions {
  typesKey?: string;
  typeHandlers?: TypeHandlerList;
  /**
   * File and Blob values are rejected by default so callers do not accidentally
   * treat binary uploads as typed scalar data.
   */
  files?: "throw" | "preserve";
}

export type DecodableEntryValue = FormDataEntryValue | Blob;
export type DecodableEntry = [string, DecodableEntryValue];

export function decode<T = unknown>(
  data: FormData | Iterable<DecodableEntry>,
  options?: DecodeOptions,
): T {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;
  const raw: [string, string][] = [];
  const preservedRaw: ParsedPathEntry[] = [];
  let typesJson: string | undefined;
  const registry = createTypeRegistry(options?.typeHandlers);
  const fileStrategy = options?.files ?? "throw";

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
      preservedRaw.push(parsePathEntry(key, value));
      continue;
    }
    if (key === typesKey) {
      if (typesJson !== undefined) {
        throw new TypeError(`Invalid superformdata metadata: duplicate "${typesKey}" field`);
      }
      typesJson = value;
    } else {
      raw.push([key, value]);
    }
  }

  let types: Record<string, string> = {};
  if (typesJson !== undefined) {
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
      structuralPaths.push({ path, typeId });
    }
  }

  // Deserialize leaf values
  const deserialized: ParsedPathEntry[] = [...preservedRaw];
  const parentPaths = new Set<string>();
  const parentPathCache = new Map<string, Map<PathSegment, string>>();
  for (const entry of preservedRaw) addParentPaths(parentPaths, parentPathCache, entry);

  for (const [path, value] of raw) {
    const typeId = types[path];
    const parsed = parsePathEntry(path, value);
    addParentPaths(parentPaths, parentPathCache, parsed);
    if (typeId && !isStructuralType(typeId)) {
      const handler = getHandler(typeId, registry)!;
      try {
        deserialized.push({ ...parsed, value: handler.deserialize(value) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : `could not deserialize ${typeId}`;
        throw new TypeError(`Invalid value for typed field "${path}": ${reason}`);
      }
      continue;
    }
    deserialized.push(parsed);
  }

  // Build lookup sets once so empty-container reconstruction does not scan
  // all decoded entries for every structural metadata path.
  const entryPaths = new Set<string>();
  for (const entry of deserialized) entryPaths.add(entry.path);

  // Add empty container markers
  for (const { path, typeId } of structuralPaths) {
    if (entryPaths.has(path)) continue;
    if (parentPaths.has(path)) continue;

    const sparseArrayLength = parseSparseArrayTypeId(typeId);
    const segments = parsePath(path);

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
    .map(({ path, typeId }): [string, number] | undefined => {
      const length = parseSparseArrayTypeId(typeId);
      return length === undefined ? undefined : [path, length];
    })
    .filter((item): item is [string, number] => item !== undefined)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [path, length] of sortedSparseArrays) {
    if (path === "") {
      if (Array.isArray(result)) {
        validateSparseArrayLength(path, result, length);
        result.length = length;
      }
    } else {
      resizeArray(result, path, parsePath(path), length);
    }
  }

  // Post-process structural types (deepest-first)
  const sortedStructural = structuralPaths
    .filter(({ typeId }) => typeId === "set" || typeId === "map")
    .sort((a, b) => b.path.length - a.path.length);

  for (const { path, typeId } of sortedStructural) {
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
      convertStructural(result, path, parsePath(path), typeId);
    }
  }

  return result as T;
}

function createSparseArray(length: number): unknown[] {
  const array: unknown[] = [];
  array.length = length;
  return array;
}

function addParentPaths(
  parentPaths: Set<string>,
  parentPathCache: Map<string, Map<PathSegment, string>>,
  entry: ParsedPathEntry,
): void {
  if (entry.segments.length === 0) return;

  parentPaths.add("");

  let parentPath = "";
  for (let i = 0; i < entry.segments.length - 1; i++) {
    const segment = entry.segments[i]!;
    let childCache = parentPathCache.get(parentPath);
    if (childCache === undefined) {
      childCache = new Map();
      parentPathCache.set(parentPath, childCache);
    }

    const cachedParentPath = childCache.get(segment);
    if (cachedParentPath === undefined) {
      parentPath =
        typeof segment === "number"
          ? appendIndex(parentPath, segment)
          : appendKey(parentPath, segment);
      childCache.set(segment, parentPath);
    } else {
      parentPath = cachedParentPath;
    }
    parentPaths.add(parentPath);
  }
}

export async function decodeRequest<T = unknown>(
  request: Request,
  options?: DecodeOptions,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();

  if (mediaType === "multipart/form-data") {
    return decode<T>(await withNormalizedContentType(request, mediaType).formData(), options);
  }

  if (mediaType === "application/x-www-form-urlencoded") {
    return decode<T>(new URLSearchParams(await request.text()), options);
  }

  if (mediaType === "text/plain") {
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

function withNormalizedContentType(request: Request, mediaType: string): Request {
  const headers = new Headers(request.headers);
  const contentType = headers.get("content-type");
  const parameters = contentType?.split(";").slice(1).join(";") ?? "";
  headers.set("content-type", parameters ? `${mediaType};${parameters}` : mediaType);

  return new Request(request, { headers });
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

function resizeArray(
  root: unknown,
  path: string,
  segments: readonly PathSegment[],
  length: number,
): void {
  if (segments.length === 0) return;

  let current: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]!] as Record<string | number, unknown>;
    if (current === undefined) return;
  }

  const lastSeg = segments[segments.length - 1]!;
  const value = current[lastSeg];
  if (!Array.isArray(value)) return;

  validateSparseArrayLength(path, value, length);
  value.length = length;
}

function validateSparseArrayLength(path: string, value: readonly unknown[], length: number): void {
  for (const key of Object.keys(value)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < length) continue;

    throw new TypeError(
      `Invalid superformdata metadata: sparse array length ${length} at path "${path}" would truncate decoded index ${index}`,
    );
  }
}
