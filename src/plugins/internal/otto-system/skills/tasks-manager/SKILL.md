---
name: tasks-manager
description: |
  DEPRECATED. Compatibility alias for old TASK.md-first task handling.
  Use `otto-system-tasks` for all current Otto task runtime work.
---

# Deprecated: Tasks Manager

This skill is a managed compatibility alias for `otto-system-tasks`.

Use `otto-system-tasks` for profile-aware task work. Do not dispatch new work to
`otto-system-tasks-manager`.

Removal target: when compatibility is no longer needed, delete this source alias
and run:

```bash
otto skills sync --json
```
