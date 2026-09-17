# Documentation map

Use this page to find the document that describes the current codebase or the
work that is still planned. Dated session notes live in [`archive/`](archive/)
and are context only — they are **not** implementation instructions.

## Start here

- [`../README.md`](../README.md) — prerequisites, local setup, and commands.
- [`../AGENTS.md`](../AGENTS.md) — working rules for AI coding agents, commands,
  and architecture notes. The single source of truth shared with other agents.
- [`STATUS.md`](STATUS.md) — **read this before starting work.** Current branch
  and worktree state, unmerged work, and known landmines.

## The codebase as it is

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system boundaries and encryption model.
- [`API.md`](API.md) — REST and WebSocket reference.
- [`DATABASE.md`](DATABASE.md) — schema and schema-evolution notes.

## Current work and decisions

- [`SECURITY_PLAN.md`](SECURITY_PLAN.md) — security findings and remediation
  order. **Owned by Codex**; do not change findings or sequencing without them.
- [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) — proposal for
  managed auth (Clerk), object storage (R2), and attachment encryption,
  including why InsForge is rejected. Proposal, not approved.
- [`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md) — open product and operational
  work. Security defects deliberately live in `SECURITY_PLAN.md` instead.

## Process retrospectives

Session 1 analyses, retained because their conclusions shaped the working rules
at the top of [`../AGENTS.md`](../AGENTS.md):

- [`AGENT_OPERATIONS.md`](AGENT_OPERATIONS.md) — what each agent produced, and
  the per-agent scorecard.
- [`INTERACTION_PATTERNS.md`](INTERACTION_PATTERNS.md) — how work was
  communicated, and why enthusiasm was a negative signal for reliability.

## Historical context

- [`archive/SESSION_1_HANDOFF_2026-08-10.md`](archive/SESSION_1_HANDOFF_2026-08-10.md)
  — superseded end-of-session handoff, formerly `TOMORROW.md`. Branch names and
  SHAs in it are stale.

## Documents that exist only on a branch

`codex/security-program` carries documentation `master` has never had — notably
`MINIO_DELEGATION_GUIDE.md` (staged object-storage migration and delegation
boundaries) and `FUTURE_FEATURES.md` (untriaged ideas and open product
questions). They are entangled with unmerged code on that branch. See
[`STATUS.md`](STATUS.md#documentation-divergence).
