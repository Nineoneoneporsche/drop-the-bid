# Claude Code Start Prompt

Read these files first and do not edit code yet:

- AGENTS.md
- DTB_MASTER_CONTEXT.md
- DTB_CURRENT_STATE.md
- DTB_DECISION_LOG.md
- DTB_SESSION_SNAPSHOT.md if present

Then inspect:
- git status
- current branch
- last 15 commits
- recent auth/login related diffs
- Supabase client initialization
- login provider calls
- auth callback route
- any middleware or redirect guards
- Vercel/env usage without printing secret values

Current incident:
DTB login used to work and now fails. Management API verification already confirmed:
- site_url=https://dropthebid.com
- production callback/reset URLs are allow-listed
- preview callback/reset URLs exist
- linked Supabase ref matches app .env.local ref
Therefore do NOT propose changing Site URL or redirect allow-list unless new evidence contradicts this.

Goal:
Find the regression that explains why login stopped working.

First response must contain only:
1. current code path for login
2. recent commits that could have affected it
3. top hypotheses ranked by evidence
4. exact non-destructive checks to distinguish them

Do not modify code until the cause is narrowed down.
Do not print secrets.
