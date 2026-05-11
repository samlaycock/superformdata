import { MAX_SPARSE_ARRAY_LENGTH } from "./path.ts";
import { getHandler, type TypeRegistry } from "./types.ts";

const STRUCTURAL_TYPES = new Set(["set", "map", "array", "object"]);

export function validateKnownTypeIds(types: Record<string, string>, registry: TypeRegistry): void {
  for (const [path, typeId] of Object.entries(types)) {
    validateKnownTypeId(path, typeId, registry);
  }
}

export function validateKnownTypeId(path: string, typeId: string, registry: TypeRegistry): void {
  if (isStructuralType(typeId)) return;
  if (getHandler(typeId, registry)) return;

  throw new TypeError(`Unknown type id "${typeId}" for typed field "${path}"`);
}

export function isStructuralType(typeId: string): boolean {
  return STRUCTURAL_TYPES.has(typeId) || parseSparseArrayTypeId(typeId) !== undefined;
}

export function parseSparseArrayTypeId(typeId: string): number | undefined {
  if (!typeId.startsWith("array:")) return undefined;

  const rawLength = typeId.slice("array:".length);
  if (!/^(?:0|[1-9]\d*)$/.test(rawLength)) return undefined;

  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_SPARSE_ARRAY_LENGTH) return undefined;

  return length;
}
