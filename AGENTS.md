# 项目 Agent 指引

当新增或修改渲染层页面、布局、卡片、表单、表格或页面响应式样式时，必须先阅读并遵循 `.codex/skills/app-page-layout/SKILL.md`。

此 Skill 是本项目的通用页面布局规范；不要在单个页面重复定义已由全局样式或通用组件提供的页面框架。修改完成后应遵守 Skill 中的滚动、响应式与验证要求。

<!-- codex-subagent-pack:start -->

## Codex Subagent Pack routing policy

The active Codex model is the parent coordinator.

The parent owns:

- requirement interpretation;
- architecture and product decisions;
- security-sensitive reasoning;
- final diff review;
- final user-facing output.

Use installed helper agents for bounded work according to their declared role,
model, reasoning effort, sandbox, and output contract.

When proactive delegation is available, prefer installed specialized agents
whose descriptions match the subtask. Otherwise, explicitly spawn the relevant
installed agent.

The parent must review all helper-agent results before finalizing.

### Installed helper agents

| Agent | Role | Model | Effort | Sandbox |
|---|---|---|---|---|
| `csp_codebase_explorer` | Locate relevant files, symbols, call paths, and root areas for the parent coordinator. | `gpt-5.6-luna` | low | read-only |
| `csp_log_summarizer` | Condense noisy logs, CI output, stack traces, and lint failures for the parent coordinator. | `gpt-5.6-luna` | low | read-only |
| `csp_patch_worker` | Apply small, targeted code edits after the parent coordinator identifies scope and strategy. | `gpt-5.6-terra` | medium | workspace-write |
| `csp_reviewer` | Review focused local changes for bugs, missing tests, risky edge cases, and regressions. | `gpt-5.6-terra` | high | read-only |
| `csp_test_writer` | Write focused unit or regression tests for a specified function, component, or bug fix. | `gpt-5.6-terra` | medium | workspace-write |

### Routing rules

- Use helper agents for bounded, local, read-heavy, log-heavy, test-writing, implementation, or review tasks.
- Prefer Luna for clear and repeatable work.
- Prefer Terra for general implementation and everyday reasoning.
- Prefer Sol for complex, ambiguous, or high-value review work.
- Keep final architecture, security-sensitive decisions, auth, payment, secrets, destructive operations, and final approval in the parent.
- Pass only the minimum relevant context.
- Require concise structured output.
- Avoid parallel write-heavy agents that may edit overlapping files.
- Max and Ultra are reasoning modes, not model IDs; helper packs do not enable them by default.
- Keep `agents.max_depth = 1` unless the user explicitly changes their Codex configuration.

<!-- codex-subagent-pack:end -->
