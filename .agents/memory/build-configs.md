---
name: Vite artifact build defaults
description: Vite artifact configs must support clean workspace builds without workflow-injected runtime variables.
---

Vite configs should keep strict `PORT` and `BASE_PATH` requirements for development servers, but provide safe artifact-specific defaults when the command is a production build.

**Why:** The root workspace build runs package build scripts outside managed workflows, so workflow-injected environment variables are absent even though development workflows provide them.

**How to apply:** Detect the build command in each artifact config and default only the values needed to generate static output; do not weaken development startup validation.