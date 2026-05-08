---
"superformdata": patch
---

Reject unsafe decoded path segments such as `__proto__`, `prototype`, and `constructor` to prevent prototype pollution during `decode()`.
