---
"superformdata": patch
---

Validate `encode(form, { submitter })` submitters before encoding so non-submit controls and controls owned by another form throw like native `FormData(form, submitter)`.
