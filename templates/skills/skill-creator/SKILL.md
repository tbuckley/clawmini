---
name: skill-creator
description: Use this skill to create a new Agent Skill. It provides best practices, specification details, and instructions on where to place your skills.
---

# Agent Skill Creator Guide

This document provides comprehensive instructions on how to create, structure, and optimize Agent Skills based on the official [Agent Skills Specification](https://agentskills.io).

## Skill Locations

You can create skills in two locations depending on their intended scope:

- **Project-Specific:** Create skills in `.gemini/skills/<skill-name>/` at the root of your project. These will only be available when working within this project.
- **Global:** Create skills in `~/.gemini/skills/<skill-name>/` in your home directory. These will be available to agents across all projects on your machine.

## 1. Specification & Directory Structure

A skill is defined by a directory containing a mandatory `SKILL.md` file. The directory name must exactly match the `name` field in the `SKILL.md` frontmatter.

**Example Structure:**

```text
.gemini/skills/my-awesome-skill/
├── SKILL.md         # Mandatory: Contains metadata and instructions
├── scripts/         # Optional: Executable code or helper scripts
├── references/      # Optional: Documentation or long-form context
└── assets/          # Optional: Templates or data files
```

### The SKILL.md File

The `SKILL.md` file must begin with YAML frontmatter containing metadata, followed by Markdown formatted instructions.

**Frontmatter Fields:**

- `name` (Required): 1-64 characters, lowercase alphanumeric and hyphens only. Must match the directory name.
- `description` (Required): 1-1024 characters. **Crucial for activation**—this is what the agent reads to decide if it should trigger the skill.
- _Optional:_ `license`, `compatibility`, `metadata`, `allowed-tools`.

## 2. Best Practices for Skill Creation

- **Be Specific & Grounded:** Focus on domain-specific expertise, local project conventions, and specific API usages that the agent wouldn't inherently know. Extract instructions from real workflows or runbooks.
- **Context Efficiency:** Omit general knowledge. Keep the main `SKILL.md` concise (ideally under 500 lines). The agent uses progressive disclosure: it loads only the description until the skill is activated, and fetches `scripts/` or `references/` only when explicitly instructed.
- **Use Clear Instruction Patterns:**
  - **Templates:** Provide concrete structures for desired output formats.
  - **Checklists:** Help the agent track progress in multi-step workflows.
  - **Validation Loops:** Instruct the agent to "Plan-Validate-Execute" (especially for destructive actions) to ensure correctness before execution.
- **Calibrate Control:** Be highly prescriptive for fragile tasks, but allow flexibility for creative tasks. Provide clear defaults rather than a menu of options.

## 3. Optimizing Skill Descriptions

Because agents use _only_ the `description` field to decide whether to trigger a skill, optimizing it is critical.

- **Focus on Intent:** Write descriptions based on the user's intent rather than technical implementation details. Use imperative phrasing like "Use this skill when...".
- **Include Context:** Explicitly list relevant contexts, even if the user might not use specific keywords in their prompt.
- **Avoid Keyword Stuffing:** Be specific enough to trigger correctly, but don't just list keywords without context.
- **Evaluation & Tuning:** Test your description against a set of queries:
  - _Should-trigger:_ Ensure varied phrasing activates the skill.
  - _Should-not-trigger:_ Use "near-miss" queries (sharing keywords but needing different capabilities) to prevent false positives and over-triggering.
