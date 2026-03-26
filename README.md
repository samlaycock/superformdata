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
const value = decode(entries);
```

## Decode a Request

```ts
import { decodeRequest } from "superformdata";

export async function POST(request: Request) {
  const data = await decodeRequest(request);
  return Response.json(data);
}
```

## Browser Form Helpers

Use the change handlers to annotate form inputs with type metadata before submit.

```ts
import { onDateChange, onNumberChange } from "superformdata";

document.querySelector('input[name="count"]')?.addEventListener("change", onNumberChange);

document.querySelector('input[name="createdAt"]')?.addEventListener("change", onDateChange);
```

Then pass the form to `encode()`:

```ts
import { encode } from "superformdata";

const form = document.querySelector("form");
const entries = encode(form!);
```

## API

```ts
encode(input: unknown, options?: { typesKey?: string; types?: Record<string, string> }): [string, string][]
decode(data: FormData | Iterable<[string, FormDataEntryValue]>, options?: { typesKey?: string }): unknown
decodeRequest(request: Request, options?: { typesKey?: string }): Promise<unknown>
onChange(typeId: string, options?: { typesKey?: string }): (event: Event) => void
```

## License

MIT
