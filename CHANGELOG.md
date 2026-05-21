# superformdata

## 0.2.1

### Patch Changes

- 6ad5e8b: Preserve plain object Blob values when encoding with `files: "preserve"`.
- 1a4dc4c: Reject plain-value root fields that collide with the reserved metadata key.
- 558c5f0: Reject ambiguous key text immediately after bracketed array indexes.
- 1bfd999: Normalize and strictly match decodeRequest content types before decoding request bodies.
- e10484c: Validate `encode(form, { submitter })` submitters before encoding so non-submit controls and controls owned by another form throw like native `FormData(form, submitter)`.
- e8feebd: Reject sparse array metadata that would truncate decoded values.

## 0.2.0

### Minor Changes

- 4783223: Add an opt-in `files: "preserve"` strategy for preserving `File` entries while encoding and decoding typed scalar form data.
- dc8c7a7: Add `superformdata/core` and `superformdata/client` subpath exports while preserving the root entrypoint.

### Patch Changes

- 4576614: Exclude listed form elements that are not successful controls when encoding forms.
- cd22d22: Reject ambiguous scalar/container path collisions during decode with a clear TypeError.
- 60a5a00: Reduce repeated handler scans and path parsing while encoding and decoding large payloads.
- 5383582: Preserve empty string object keys during encode/decode round trips.
- 1d6a2ea: Preserve Error names and cause details when encoding and decoding Error values, while continuing to decode legacy plain-message Error payloads.
- 3e727c5: Report invalid Date values during encode with a path-aware TypeError.
- cf1a996: Add first-class `encode()` support for `URLSearchParams` inputs.
- 7eec8d2: Add explicit PR CI coverage for package builds and built package import/type smoke tests.
- fc42ea2: Preserve sparse array holes during encode/decode round trips instead of densifying them as explicit `undefined` values.
- 085494b: Skip form controls disabled by ancestor fieldsets during form encoding, while preserving the native first-legend exception.
- ba75d8f: Reject mixed top-level object and array paths during `decode()` instead of producing hybrid root containers.
- 97bbe24: Reject unknown `$types` metadata ids during `decode()` instead of silently returning raw string values.
- f3e7645: Reject unsafe decoded path segments such as `__proto__`, `prototype`, and `constructor` to prevent prototype pollution during `decode()`.
- 3cc71a8: Add a Bun-native manual benchmark suite for large encode/decode payloads.
- 1db7627: Reject malformed decoded paths, duplicate metadata fields, and invalid existing metadata passed through `encode()`.
- 45e695a: Reject decoded values when `set` or `map` structural metadata does not match the decoded value shape.
- 2910e26: Validate type metadata generated or forwarded by `encode()` and client change helpers.
- 952c363: Validate decoded `$types` metadata so malformed object shapes and non-string type ids fail with clear `TypeError` messages.

## 0.1.0

### Minor Changes

- 27ea00d: Expose per-call custom type handlers for encoding and decoding domain-specific values.

### Patch Changes

- 72e3d1f: The browser change helpers now support custom `typesKey` metadata fields consistently via `createChangeHandlers({ typesKey })`, and the built-in boolean helper no longer hard-codes `$types` internally.
- bc52d24: `encode()` and `decode()` now throw a descriptive `TypeError` when they encounter a `File` entry (from a file input or `FormData`) instead of silently dropping it. This prevents multipart forms from appearing to work while quietly discarding attachments.
- 302b88d: `decodeRequest()` now throws a descriptive `TypeError` for unsupported content types (including missing `Content-Type` headers) instead of silently falling back to `request.formData()`.
- 08ee266: The browser change helpers now reset malformed hidden metadata instead of throwing when updating field type information.
- 3d00f4e: Avoid repeated prefix scans when decode reconstructs empty typed containers.
- 25537d5: Reject invalid or oversized bracket indexes during decode to avoid constructing pathological sparse arrays from untrusted input.
- 2f7991a: Typed deserialization now rejects malformed `Date`, `RegExp`, `number`, and `boolean` wire values instead of silently coercing them, and `decode()` surfaces the failing field path in the error message.
