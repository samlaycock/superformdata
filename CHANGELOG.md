# superformdata

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
