---
"superformdata": patch
---

`encode()` and `decode()` now throw a descriptive `TypeError` when they encounter a `File` entry (from a file input or `FormData`) instead of silently dropping it. This prevents multipart forms from appearing to work while quietly discarding attachments.
