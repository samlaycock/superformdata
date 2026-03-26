export interface TypeHandler<T = unknown> {
  id: string;
  test: (value: unknown) => value is T;
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
}

type RegisteredTypeHandler = TypeHandler<unknown>;

function defineTypeHandler<T>(handler: TypeHandler<T>): RegisteredTypeHandler {
  return {
    id: handler.id,
    test: handler.test as RegisteredTypeHandler["test"],
    serialize: (value) => handler.serialize(value as T),
    deserialize: (raw) => handler.deserialize(raw),
  };
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
    deserialize: (s) => new Date(s),
  }),
  defineTypeHandler({
    id: "RegExp",
    test: (v): v is RegExp => v instanceof RegExp,
    serialize: (v) => v.toString(),
    deserialize: (s) => {
      const lastSlash = s.lastIndexOf("/");
      return new RegExp(s.slice(1, lastSlash), s.slice(lastSlash + 1));
    },
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
    deserialize: (s) => Number(s),
  }),
  defineTypeHandler({
    id: "boolean",
    test: (v): v is boolean => typeof v === "boolean",
    serialize: (v) => String(v),
    deserialize: (s) => s === "true",
  }),
  defineTypeHandler({
    id: "null",
    test: (v): v is null => v === null,
    serialize: () => "",
    deserialize: () => null,
  }),
];

const handlerMap = new Map<string, RegisteredTypeHandler>();
for (const handler of typeHandlers) {
  handlerMap.set(handler.id, handler);
}

export function findHandler(value: unknown): RegisteredTypeHandler | undefined {
  if (typeof value === "string") return undefined;
  return typeHandlers.find((h) => h.test(value));
}

export function getHandler(id: string): RegisteredTypeHandler | undefined {
  return handlerMap.get(id);
}
