LIVING_DOC_SYSTEM.md
LIVING DOC SYSTEM
## 1. Core Principles
### One file owns each rule. No duplication. If a rule exists in two places, you have two sources of truth, which means you have none.

### Read before acting. The agent must read agent.md at the start of every session to establish context. For deeper tasks, the agent must look up the relevant files from the registry.

### Update only on request. The agent will register new files, enforce ownership, and keep the registry accurate only when the human explicitly requests a "doc sweep" after approving code changes.

### The human checkpoint is the system. The agent cannot catch if wrong behavior is approved; it trusts the human's confirmation. Garbage in, garbage out.

## 2. Directory Structure & Ownership

### agent.md: The entry point. Contains session-critical rules, tech stack (React, TypeScript, Vite, Supabase), and quick-reference checklists. Short by design.

### docs/ARCH_technical-specs.md: Owns data structures, database schema (PsychE_ tables), and routing logic.

### docs/GUIDE_developer.md: Owns frontend coding standards, UI language (Bento Grid, minimalist A4 print views, Apple-style Master-Detail UI), and state management rules.

### docs/ARCH_documentation-governance.md: The registry. Every doc file is mapped here by what it contains, what it must not contain, and when to load it.

### Query the Graph: Before modifying complex data flows or architecture, always use the /graphify skill to run graphify query or graphify path to trace exactly how files and dependencies connect. Do not blindly search through files.