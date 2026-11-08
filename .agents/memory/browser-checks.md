---
name: Browser checks on NixOS
description: Browser runtime choice for local interaction verification.
---

Prefer the environment-provided Chromium for local Playwright interaction checks rather than downloading a browser build.

**Why:** Downloaded browser binaries can fail to launch on this NixOS environment because their expected native shared libraries are not available through the normal loader.

**How to apply:** Discover the installed Chromium executable before installing browser binaries. A launch failure is an environment problem, not evidence that the application itself is broken.
