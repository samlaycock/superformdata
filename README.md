# superformdata

Serialize rich JavaScript values into form-style entries and decode them back again.

`superformdata` is useful when you want to move data through `FormData`, URL-encoded forms, or request bodies without flattening everything to strings yourself.

## Installation

```bash
npm install superformdata
```

## What It Handles

- Plain objects and arrays
- `Date`
- `Set`
- `Map`
- `bigint`
- `RegExp`
- `URL`
- `Error`
- `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, `-0`

## Basic Usage

```ts
import { decode, encode } from "superformdata";

const input = {
  user: {
    name: "Alice",
    joined: new Date("2024-01-01T00:00:00.000Z"),
  },
  tags: new Set(["admin", "editor"]),
  count: 42,
};

const entries = encode(input);
const value = decode<typeof input>(entries);
```

## `encode()`

Serialize a rich value into form-style entries.

```ts
import { encode } from "superformdata";

const entries = encode({
  title: "Quarterly report",
  publishedAt: new Date("2024-01-01T00:00:00.000Z"),
  views: 1200,
  featured: true,
});

console.log(entries);
// [
//   ["title", "Quarterly report"],
//   ["publishedAt", "2024-01-01T00:00:00.000Z"],
//   ["views", "1200"],
//   ["featured", "true"],
//   ["$types", "{\"publishedAt\":\"Date\",\"views\":\"number\",\"featured\":\"boolean\"}"]
// ]
```

## `decode()`

Decode `FormData` entries back into a typed value.

```ts
import { decode } from "superformdata";

const entries = [
  ["user.name", "Alice"],
  ["user.joinedAt", "2024-01-01T00:00:00.000Z"],
  ["active", "true"],
  ["$types", '{"user.joinedAt":"Date","active":"boolean"}'],
] satisfies [string, string][];

const value = decode<{
  user: {
    name: string;
    joinedAt: Date;
  };
  active: boolean;
}>(entries);
```

When the same decoded field path appears more than once, `decode()` preserves every value by collecting them into an array in entry order.

```ts
decode([
  ["tags", "a"],
  ["tags", "b"],
]);
// => { tags: ["a", "b"] }
```

## File and Blob Entries

`superformdata` rejects `File` entries by default. This keeps binary uploads explicit and prevents accidental attempts to decode files as typed scalar fields.

Pass `{ files: "preserve" }` when you want to send typed scalar fields alongside file uploads.

```ts
import { decode, encode } from "superformdata";

const formData = new FormData();
formData.append("title", "Quarterly report");
formData.append("views", "1200");
formData.append("attachment", new File(["content"], "report.txt"));

const entries = encode(formData, {
  files: "preserve",
  types: { views: "number" },
});
// entries is typed as [string, string | File][]

const value = decode<{
  title: string;
  views: number;
  attachment: File;
}>(entries, { files: "preserve" });
```

The same option works with `encode(form)` for `<input type="file">` controls, plain object `File` values, and `decodeRequest()` for multipart requests. Without `{ files: "preserve" }`, file inputs and file entries continue to throw.

## Decode a Request

```ts
import { decodeRequest } from "superformdata";

export async function POST(request: Request) {
  const data = await decodeRequest<{
    name: string;
    count: number;
    createdAt: Date;
  }>(request);
  return Response.json(data);
}
```

## Custom Type Handlers

Pass custom handlers to `encode()` and `decode()` when you need to round-trip domain-specific values.

```ts
import { decode, encode, type TypeHandler } from "superformdata";

interface Money {
  readonly cents: number;
}

const moneyHandler: TypeHandler<Money> = {
  id: "Money",
  test: (value): value is Money =>
    typeof value === "object" &&
    value !== null &&
    "cents" in value &&
    typeof value.cents === "number",
  serialize: (value) => String(value.cents),
  deserialize: (raw) => ({ cents: Number(raw) }),
};

const entries = encode({ price: { cents: 1299 } }, { typeHandlers: [moneyHandler] });
const value = decode<{ price: Money }>(entries, { typeHandlers: [moneyHandler] });
```

Custom handler IDs must be unique and cannot use built-in or structural IDs such as `number`, `Date`, `set`, or `map`.

## `decodeRequest()`

Decode a `Request` body directly.

```ts
import { decodeRequest } from "superformdata";

export async function action(request: Request) {
  const data = await decodeRequest<{
    email: string;
    subscribed: boolean;
  }>(request);

  return Response.json({
    email: data.email,
    subscribed: data.subscribed,
  });
}
```

## Browser Form Helpers

Use the change handlers to annotate form inputs with type metadata before submit.

```ts
import {
  onBigIntChange,
  onBooleanChange,
  onChange,
  onDateChange,
  onNumberChange,
  onURLChange,
} from "superformdata";

document.querySelector('input[name="count"]')?.addEventListener("change", onNumberChange);
document.querySelector('input[name="createdAt"]')?.addEventListener("change", onDateChange);
document.querySelector('input[name="isAdmin"]')?.addEventListener("change", onBooleanChange);
document.querySelector('input[name="accountId"]')?.addEventListener("change", onBigIntChange);
document.querySelector('input[name="website"]')?.addEventListener("change", onURLChange);

// Use onChange() when you want to set the type id yourself.
document.querySelector('input[name="pattern"]')?.addEventListener("change", onChange("RegExp"));
```

Then pass the form to `encode()`:

```ts
import { encode } from "superformdata";

const form = document.querySelector("form");
const entries = encode(form!);
```

## `data-sf-*` Attributes

The package currently recognizes `data-sf-type`.

- `data-sf-type` tells `encode(form)` which type handler to use for that field.
- The helper functions like `onDateChange()` and `onNumberChange()` set `data-sf-type` for you.
- You can also set it manually in your HTML if the type is already known.

```html
<form id="post-form">
  <input name="publishedAt" value="2024-01-01T00:00:00.000Z" data-sf-type="Date" />
  <input name="views" value="1200" data-sf-type="number" />
  <input name="homepage" value="https://example.com" data-sf-type="URL" />
</form>
```

```ts
import { encode } from "superformdata";

const form = document.querySelector<HTMLFormElement>("#post-form")!;
const entries = encode(form);
```

For checkboxes, `data-sf-type="boolean"` has special handling: the field is always included and encoded as `"true"` or `"false"` based on `checked`.

```html
<input name="published" type="checkbox" data-sf-type="boolean" />
```

No other `data-sf-*` attributes are currently read by the package.

### `onChange()`

Attach your own type id to an input.

```ts
import { onChange } from "superformdata";

const patternInput = document.querySelector<HTMLInputElement>('input[name="pattern"]')!;
patternInput.addEventListener("change", onChange("RegExp"));
```

### `onDateChange()`

```ts
import { onDateChange } from "superformdata";

document.querySelector('input[name="publishedAt"]')?.addEventListener("change", onDateChange);
```

### `onNumberChange()`

```ts
import { onNumberChange } from "superformdata";

document.querySelector('input[name="price"]')?.addEventListener("change", onNumberChange);
```

### `onBooleanChange()`

```ts
import { onBooleanChange } from "superformdata";

document.querySelector('input[name="completed"]')?.addEventListener("change", onBooleanChange);
```

### `onBigIntChange()`

```ts
import { onBigIntChange } from "superformdata";

document.querySelector('input[name="orderId"]')?.addEventListener("change", onBigIntChange);
```

### `onURLChange()`

```ts
import { onURLChange } from "superformdata";

document.querySelector('input[name="homepage"]')?.addEventListener("change", onURLChange);
```

## API

```ts
encode<T>(input: T, options?: { typesKey?: string; types?: Record<string, string>; typeHandlers?: readonly TypeHandler[]; files?: "throw" | "preserve" }): [string, string][]
encode<T>(input: T, options: { files: "preserve"; typesKey?: string; types?: Record<string, string>; typeHandlers?: readonly TypeHandler[] }): [string, string | File][]
decode<T = unknown>(data: FormData | Iterable<[string, FormDataEntryValue]>, options?: { typesKey?: string; typeHandlers?: readonly TypeHandler[]; files?: "throw" | "preserve" }): T
decodeRequest<T = unknown>(request: Request, options?: { typesKey?: string; typeHandlers?: readonly TypeHandler[]; files?: "throw" | "preserve" }): Promise<T>
onChange(typeId: string, options?: { typesKey?: string }): (event: Event) => void
```

## License

MIT
