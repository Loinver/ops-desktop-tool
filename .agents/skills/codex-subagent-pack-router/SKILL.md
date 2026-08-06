---
name: codex-subagent-pack-router
description: Route bounded Codex work to installed GPT-5.6 Sol, Terra, Luna, Spark, compatibility-model, or read-only custom-provider helper agents. Keep final architecture, security decisions, and approval in the active parent coordinator.
---

# Codex Subagent Pack Router

The active Codex model is the parent coordinator.

## Workflow

1. Read the installed helper-agent table in AGENTS.md.
2. Match one bounded subtask to one installed agent by role, model, effort, and sandbox.
3. Prefer Luna for repeatable extraction and exploration, Terra for implementation, and Sol for complex review.
4. Pass minimum context and require concise structured output.
5. Avoid overlapping workspace-write agents.
6. Review all helper output in the parent before finalizing.
7. Keep architecture, auth, payment, secrets, cryptography, destructive operations, and broad ambiguous refactors in the parent.
8. Treat Max and Ultra as explicit reasoning modes, never as model IDs.
