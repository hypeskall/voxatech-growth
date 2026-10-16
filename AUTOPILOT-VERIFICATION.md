# Voxa verification — 1 October 2026

Production: https://voxa-growth.vercel.app/autopilot. Deployment is restricted to the separate **voxa-growth** project. No source or deployment changes to voxatech.ro or voxa-system.

## Verified

- 39 automated tests pass, including selected-lead scheduling without Brave, excluding self from duplicate checks, suppression/contact deduplication, atomic daily caps, repeated commits, one unapproved draft, stale leases, retries and pause.
- TypeScript, ESLint and production cloud build pass.
- Eight simultaneous hosted PostgreSQL workers claim eight different jobs. Competing $0.60 reservations against a $1 budget accept exactly one. Hosted retry backoff, stale-token refusal and pause pass. Temporary fixtures are removed.
- Four Autopilot tables enforce RLS and deny direct member writes. Fifteen worker functions deny anonymous/member execution; security advisor reports no Autopilot findings.
- Authenticated dashboard/API return 200; anonymous settings and scheduler return 401; foreign-origin mutations return 403; unconfigured Start returns 400 and remains paused.
- Protected worker and actual Supabase `pg_net` transport return 200 with `processed: 0` while paused. Scheduler is active every five minutes.
- Production delivery is `log`, source mode is `supplied`, and Reply-To is `contact@voxatech.ro`.
- Browser verification shows Voxa, supplied-lead selection, no Brave requirement in supplied mode, and actionable missing selection/budget messages.

## Persisted outreach evidence

All 20 unapproved, unsent initial drafts for the existing ten-clinic evaluation cohort now use the owner-provided Voxa template. These are existing evaluation leads, not newly discovered Autopilot leads. Nineteen drafts were personalized deterministically from the owner's template and existing clinic names; one was additionally personalized in a bounded real Gemini verification call.

Gemini example: Orto Family · Dr. Frieda Cuibus și Dr. Marius Cuibus; source https://ortofamily.ro/; lead `81edc246-105e-4d56-8d6e-df5daa54e09c`; persisted draft `0937a15d-f9e5-484e-aa40-a2fab6e0fb9c`; model `gemini-3.8-flash`; 623 input and 285 output tokens; estimated cost **$0.001536**. Draft is unapproved and unsent. The test did not change the Autopilot budget or enable it.

Production Autopilot runs, candidates, jobs and drafts remain **zero**. No complete real Autopilot research/draft batch is claimed. Its AI budget remains zero and no lead selection is saved. Optional Brave discovery remains unavailable without its key; it is unnecessary for supplied mode.

## Required before Start

Select/import real clinic leads, choose their city/specialty, set a positive daily AI budget, save, then Start. Website evidence may disqualify a supplied lead; ten is a cap, not a guaranteed result. Replies use the configured mailbox when sending is separately enabled; mailbox delivery and CRM synchronization have not been tested in this draft-only phase.

Local machine-readable evidence: `verification-autopilot.local.json`, `verification-autopilot-production.local.json`, `verification-voxa-pitch.local.json`. Reports contain no secrets and distinguish queue fixtures, existing evaluation leads and actual Autopilot metrics.
