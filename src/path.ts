export function escapeKey(key: string): string {
  return key.replace(/[.[\]\\]/g, "\\$&");
}

export function unescapeKey(escaped: string): string {
  return escaped.replace(/\\(.)/g, "$1");
}

export function appendKey(path: string, key: string): string {
  const escaped = escapeKey(key);
  return path === "" ? escaped : `${path}.${escaped}`;
}

export function appendIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

const MAX_ARRAY_INDEX = 100_000;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type PathSegment = string | number;
type PathContainer = Record<string | number, unknown>;

function assertSafePathSegment(segment: PathSegment, path: string): void {
  if (typeof segment === "number") return;
  if (!UNSAFE_OBJECT_KEYS.has(segment)) return;

  throw new TypeError(`Unsafe path segment "${segment}" in path "${path}"`);
}

function assignPathValue(container: PathContainer, segment: PathSegment, value: unknown): void {
  const existing = container[segment];

  if (existing === undefined) {
    container[segment] = value;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }

  container[segment] = [existing, value];
}

function parseArrayIndex(raw: string, path: string): number {
  if (!ARRAY_INDEX_PATTERN.test(raw)) {
    throw new TypeError(`Invalid array index "${raw}" in path "${path}"`);
  }

  const index = Number(raw);
  if (!Number.isSafeInteger(index)) {
    throw new TypeError(`Invalid array index "${raw}" in path "${path}"`);
  }
  if (index > MAX_ARRAY_INDEX) {
    throw new TypeError(`Array index too large in path "${path}": ${index}`);
  }

  return index;
}

export function parsePath(path: string): PathSegment[] {
  if (path === "") return [];

  const segments: PathSegment[] = [];
  let current = "";
  let i = 0;

  while (i < path.length) {
    if (path[i] === "\\") {
      if (i + 1 < path.length) {
        current += path[i + 1];
        i += 2;
      } else {
        // Trailing backslash — treat as literal
        current += "\\";
        i++;
      }
    } else if (path[i] === ".") {
      segments.push(current);
      current = "";
      i++;
    } else if (path[i] === "[") {
      if (current !== "" || (segments.length === 0 && i > 0)) {
        segments.push(current);
        current = "";
      }
      const close = path.indexOf("]", i);
      if (close === -1) {
        // Malformed bracket — treat rest as literal
        current += path.slice(i);
        break;
      }
      segments.push(parseArrayIndex(path.slice(i + 1, close), path));
      i = close + 1;
      // skip trailing dot after bracket (e.g., `[0].name`)
      if (path[i] === ".") i++;
    } else {
      current += path[i];
      i++;
    }
  }

  if (current !== "" || segments.length === 0) segments.push(current);
  return segments;
}

export function unflatten(entries: [string, unknown][]): unknown {
  if (entries.length === 0) return {};
  if (entries.length === 1 && entries[0]![0] === "") return entries[0]![1];

  const firstPath = entries[0]![0];
  const root = (firstPath.startsWith("[") ? [] : {}) as PathContainer;

  for (const [path, value] of entries) {
    const segments = parsePath(path);
    if (segments.length === 0) continue;
    for (const segment of segments) {
      assertSafePathSegment(segment, path);
    }

    let current: PathContainer = root;

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const nextSeg = segments[i + 1]!;

      if (current[seg] === undefined) {
        current[seg] = (typeof nextSeg === "number" ? [] : {}) as PathContainer;
      }
      current = current[seg] as PathContainer;
    }

    const lastSeg = segments[segments.length - 1]!;
    assignPathValue(current, lastSeg, value);
  }

  return root;
}
