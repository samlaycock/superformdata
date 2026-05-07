---
"superformdata": patch
---

Typed deserialization now rejects malformed `Date`, `RegExp`, `number`, and `boolean` wire values instead of silently coercing them, and `decode()` surfaces the failing field path in the error message.
