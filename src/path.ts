export function escapeKey(key: string): string {
  if (key === "") return "\\0";
  return key.replace(/[.[\]\\]/g, "\\$&");
}

export function unescapeKey(escaped: string): string {
  if (escaped === "\\0") return "";
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
export const MAX_SPARSE_ARRAY_LENGTH = 100_000;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type PathSegment = string | number;
type PathContainer = Record<string | number, unknown>;

export interface ParsedPathEntry {
  readonly path: string;
  readonly segments: readonly PathSegment[];
  readonly value: unknown;
}

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

function formatPath(segments: PathSegment[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") return appendIndex(path, segment);
    return appendKey(path, segment);
  }, "");
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function assertNotContainerOverwrite(
  value: unknown,
  containers: WeakSet<object>,
  path: string,
): void {
  if (isObject(value) && containers.has(value)) {
    throw new TypeError(`Path collision at "${path}": cannot overwrite existing container`);
  }
}

function assertCompatibleContainer(
  value: unknown,
  containers: WeakSet<object>,
  nextSegment: PathSegment,
  collisionPath: string,
  path: string,
): void {
  if (!isObject(value) || !containers.has(value)) {
    throw new TypeError(`Path collision at "${collisionPath}" while decoding path "${path}"`);
  }

  if (Array.isArray(value) !== (typeof nextSegment === "number")) {
    throw new TypeError(
      `Path collision at "${collisionPath}" while decoding path "${path}": incompatible container type`,
    );
  }
}

function assertCompatibleRoot(root: PathContainer, firstSegment: PathSegment, path: string): void {
  if (Array.isArray(root) === (typeof firstSegment === "number")) return;

  throw new TypeError(
    `Path collision at root while decoding path "${path}": incompatible container type`,
  );
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
  let hasCurrentSegment = false;
  let i = 0;

  while (i < path.length) {
    if (path[i] === "\\") {
      if (i + 1 < path.length) {
        current += path[i + 1] === "0" ? "" : path[i + 1];
        hasCurrentSegment = true;
        i += 2;
      } else {
        throw new TypeError(`Invalid path "${path}": trailing escape character`);
      }
    } else if (path[i] === ".") {
      segments.push(current);
      current = "";
      hasCurrentSegment = false;
      i++;
    } else if (path[i] === "[") {
      if (current !== "" || hasCurrentSegment || (segments.length === 0 && i > 0)) {
        segments.push(current);
        current = "";
        hasCurrentSegment = false;
      }
      const close = path.indexOf("]", i);
      if (close === -1) {
        throw new TypeError(`Invalid path "${path}": missing closing bracket`);
      }
      segments.push(parseArrayIndex(path.slice(i + 1, close), path));
      i = close + 1;
      if (i < path.length && path[i] !== "." && path[i] !== "[") {
        throw new TypeError(`Invalid path "${path}": expected ".", "[", or end after array index`);
      }
      if (path[i] === ".") i++;
    } else {
      current += path[i];
      hasCurrentSegment = true;
      i++;
    }
  }

  if (hasCurrentSegment || segments.length === 0) segments.push(current);
  return segments;
}

export function parsePathEntry(path: string, value: unknown): ParsedPathEntry {
  return {
    path,
    segments: parsePath(path),
    value,
  };
}

export function unflattenParsed(entries: readonly ParsedPathEntry[]): unknown {
  if (entries.length === 0) return {};
  if (entries.length === 1 && entries[0]!.path === "") return entries[0]!.value;

  const firstPath = entries[0]!.path;
  const root = (firstPath.startsWith("[") ? [] : {}) as PathContainer;
  const containers = new WeakSet<object>([root]);

  for (const { path, segments, value } of entries) {
    if (segments.length === 0) continue;
    for (const segment of segments) {
      assertSafePathSegment(segment, path);
    }

    let current: PathContainer = root;
    assertCompatibleRoot(root, segments[0]!, path);

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const nextSeg = segments[i + 1]!;

      if (current[seg] === undefined) {
        const nextContainer = (typeof nextSeg === "number" ? [] : {}) as PathContainer;
        current[seg] = nextContainer;
        containers.add(nextContainer);
      } else {
        assertCompatibleContainer(
          current[seg],
          containers,
          nextSeg,
          formatPath(segments.slice(0, i + 1)),
          path,
        );
      }
      current = current[seg] as PathContainer;
    }

    const lastSeg = segments[segments.length - 1]!;
    assertNotContainerOverwrite(current[lastSeg], containers, path);
    assignPathValue(current, lastSeg, value);
  }

  return root;
}

export function unflatten(entries: [string, unknown][]): unknown {
  return unflattenParsed(
    entries.map(([path, value]) => ({
      path,
      segments: parsePath(path),
      value,
    })),
  );
}
