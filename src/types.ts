export interface TypeHandler<T = unknown> {
  readonly id: string;
  readonly test: (value: unknown) => value is T;
  readonly serialize: (value: T) => string;
  readonly deserialize: (raw: string) => T;
}

export type TypeHandlerList = readonly TypeHandler<any>[];

type RegisteredTypeHandler = TypeHandler<unknown>;

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const RESERVED_TYPE_IDS = new Set(["set", "map", "array", "object"]);

function defineTypeHandler<T>(handler: TypeHandler<T>): RegisteredTypeHandler {
  return {
    id: handler.id,
    test: handler.test as RegisteredTypeHandler["test"],
    serialize: (value) => handler.serialize(value as T),
    deserialize: (raw) => handler.deserialize(raw),
  };
}

function invalidTypedValue(typeId: string): never {
  throw new TypeError(`expected ${typeId} metadata-compatible value`);
}

function deserializeDate(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) invalidTypedValue("Date");
  return date;
}

function deserializeRegExp(raw: string): RegExp {
  if (!raw.startsWith("/")) return invalidTypedValue("RegExp");

  const lastSlash = raw.lastIndexOf("/");
  if (lastSlash <= 0) return invalidTypedValue("RegExp");

  try {
    return new RegExp(raw.slice(1, lastSlash), raw.slice(lastSlash + 1));
  } catch {
    return invalidTypedValue("RegExp");
  }
}

function deserializeNumber(raw: string): number {
  if (!NUMBER_PATTERN.test(raw)) invalidTypedValue("number");

  const value = Number(raw);
  if (!Number.isFinite(value)) invalidTypedValue("number");
  return value;
}

function deserializeBoolean(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return invalidTypedValue("boolean");
}

export const typeHandlers: RegisteredTypeHandler[] = [
  defineTypeHandler({
    id: "undefined",
    test: (v): v is undefined => v === undefined,
    serialize: () => "",
    deserialize: () => undefined,
  }),
  defineTypeHandler({
    id: "nan",
    test: (v): v is number => typeof v === "number" && Number.isNaN(v),
    serialize: () => "NaN",
    deserialize: () => NaN,
  }),
  defineTypeHandler({
    id: "infinity",
    test: (v): v is number => v === Infinity,
    serialize: () => "Infinity",
    deserialize: () => Infinity,
  }),
  defineTypeHandler({
    id: "-infinity",
    test: (v): v is number => v === -Infinity,
    serialize: () => "-Infinity",
    deserialize: () => -Infinity,
  }),
  defineTypeHandler({
    id: "-0",
    test: (v): v is number => typeof v === "number" && v === 0 && 1 / v === -Infinity,
    serialize: () => "-0",
    deserialize: () => -0,
  }),
  defineTypeHandler({
    id: "bigint",
    test: (v): v is bigint => typeof v === "bigint",
    serialize: (v) => String(v),
    deserialize: (s) => BigInt(s),
  }),
  defineTypeHandler({
    id: "Date",
    test: (v): v is Date => v instanceof Date,
    serialize: (v) => v.toISOString(),
    deserialize: deserializeDate,
  }),
  defineTypeHandler({
    id: "RegExp",
    test: (v): v is RegExp => v instanceof RegExp,
    serialize: (v) => v.toString(),
    deserialize: deserializeRegExp,
  }),
  defineTypeHandler({
    id: "URL",
    test: (v): v is URL => v instanceof URL,
    serialize: (v) => v.href,
    deserialize: (s) => new URL(s),
  }),
  defineTypeHandler({
    id: "Error",
    test: (v): v is Error => v instanceof Error,
    serialize: (v) => v.message,
    deserialize: (s) => new Error(s),
  }),
  defineTypeHandler({
    id: "number",
    test: (v): v is number => typeof v === "number",
    serialize: (v) => String(v),
    deserialize: deserializeNumber,
  }),
  defineTypeHandler({
    id: "boolean",
    test: (v): v is boolean => typeof v === "boolean",
    serialize: (v) => String(v),
    deserialize: deserializeBoolean,
  }),
  defineTypeHandler({
    id: "null",
    test: (v): v is null => v === null,
    serialize: () => "",
    deserialize: () => null,
  }),
];

const builtInTypeIds = new Set(typeHandlers.map((handler) => handler.id));
const handlerMap = new Map<string, RegisteredTypeHandler>();
for (const handler of typeHandlers) {
  handlerMap.set(handler.id, handler);
}

export function createTypeRegistry(customHandlers?: TypeHandlerList): RegisteredTypeHandler[] {
  if (!customHandlers || customHandlers.length === 0) return typeHandlers;

  const seen = new Set<string>();
  const handlers: RegisteredTypeHandler[] = [];

  for (const handler of customHandlers) {
    if (handler.id === "") {
      throw new TypeError("Custom type handler id must not be empty");
    }
    if (RESERVED_TYPE_IDS.has(handler.id) || builtInTypeIds.has(handler.id)) {
      throw new TypeError(`Custom type handler id "${handler.id}" is reserved`);
    }
    if (seen.has(handler.id)) {
      throw new TypeError(`Duplicate custom type handler id "${handler.id}"`);
    }
    seen.add(handler.id);
    handlers.push(defineTypeHandler(handler));
  }

  return [...handlers, ...typeHandlers];
}

export function findHandler(
  value: unknown,
  handlers: readonly RegisteredTypeHandler[] = typeHandlers,
): RegisteredTypeHandler | undefined {
  if (typeof value === "string") return undefined;
  return handlers.find((h) => h.test(value));
}

export function getHandler(
  id: string,
  handlers: readonly RegisteredTypeHandler[] = typeHandlers,
): RegisteredTypeHandler | undefined {
  if (handlers === typeHandlers) return handlerMap.get(id);
  return handlers.find((handler) => handler.id === id);
}
