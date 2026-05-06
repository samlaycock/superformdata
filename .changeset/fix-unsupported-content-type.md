---
"superformdata": patch
---

`decodeRequest()` now throws a descriptive `TypeError` for unsupported content types (including missing `Content-Type` headers) instead of silently falling back to `request.formData()`.
