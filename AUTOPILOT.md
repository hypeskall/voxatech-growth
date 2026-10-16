# Voxa Autopilot

Production: https://voxa-growth.vercel.app/autopilot. App and product display name: Voxa. The Vercel project remains **voxa-growth**.

## Start with your own leads

1. Import leads using the Leads page. Supply available contact details; an official website is optional.
2. On Autopilot, keep **Leadurile furnizate de mine**, select up to 100 leads, and choose their city/specialty. Defaults: București, Stomatologie, 10 qualifications/day. The existing evaluation cohort is in Brașov: choose that city if deliberately processing it.
3. Set a positive daily AI budget, save settings, then Start. Saving pauses execution. Gemini is already configured as `gemini-3.8-flash`; model and prices come from existing Settings.

Supplied mode requires no Brave key, subscription or storage permission. It researches official sites and qualifies existing leads without inserting duplicates. Each selected lead is processed once across all runs. Demo/test sources, suppressed/unsubscribed leads and previous rejections are excluded. Invalid placeholder contacts are unknown unless a valid contact is found on an official site. User-provided contacts retain separate provenance; research confidence counts website evidence rather than treating supplied contacts as verified research.

Autopilot remains paused with zero budget and no selection. No automatic real batch has been run in this state. Existing evaluation drafts are separate from Autopilot metrics.

## Website-free prospects and trash

Supplied leads without websites are eligible by default. Qualification uses the supplied city, specialty and valid contact details. Their research confidence is 0%, missing facts remain unknown, and source URLs remain empty. The configured Gemini model generates drafts from the supplied identity and the owner's template. Enable the optional website filter only when desired.

Owners/admins can delete selected leads or a single lead from its drawer. Deletion moves them to a recoverable trash, cancels queued/running jobs and outreach, removes them from Autopilot selection, and hides them from active CRM metrics. Restore preserves history but never restarts outreach. The 31 old evaluation/demo leads were moved to trash; all 10 user-imported CSV clinics remain active.

## Outreach and replies

The owner-provided email is the primary template: one system for appointments, patients, records and reception; **30 days completely free, no subsequent obligation**; a short demo invitation. Product: Voxa. Signature: `Cu respect, Rares | voxatech.ro`. Personalization uses the clinic name and at most one supported fact, with a simple opt-out line before the signature. Websites are untrusted data, never instructions.

`EMAIL_REPLY_TO=contact@voxatech.ro` is configured in production and enforced by the Resend provider. This sets Reply-To when delivery is later enabled; it does not configure or test the mailbox, DNS or automatic mailbox-to-CRM synchronization. `EMAIL_DELIVERY_MODE=log` remains enforced. No email is approved or sent and no campaign activated by Autopilot.

## Durable execution

The existing `automation_jobs` and finish/retry implementation are reused. Supabase Cron calls `/api/autopilot/cron` every five minutes through `pg_net`, independently of browser tabs and deployments. The inspected Vercel plan is Hobby. The dedicated bearer secret is stored in Supabase Vault and the sensitive Vercel variable `AUTOPILOT_CRON_SECRET`; paused settings prevent automatic external calls.

One job per invocation: research (homepage plus at most one contact page) or a draft. Claims use `FOR UPDATE SKIP LOCKED`, five-minute leases, fencing tokens and three attempts, followed by failed state. Daily quotas use Europe/Bucharest. At most ten qualifications/day; results may be fewer due to evidence, exclusions or budget. Requests have bounded deadlines, redirects, response size and SSRF/DNS protections.

AI costs are reserved atomically before calls. Failed/ambiguous calls retain conservative reservations. Successful calls settle against token usage. Each call uses one SDK attempt, a 30-second timeout and 2,500 output-token maximum. Database retries reserve fresh budget; daily budget deferrals resume after midnight without consuming retry allowance. Costs are estimates, not provider invoices.

Authenticated organization members can read; settings and controls require owner/admin and same-origin requests. Worker RPCs are service-role only. Autopilot cannot claim campaign jobs; campaign workers cannot claim Autopilot jobs.

## Optional automatic discovery

The existing Brave Web Search adapter remains available by explicitly selecting discovery mode. It requires server-only `BRAVE_SEARCH_API_KEY` in **voxa-growth**, deployment, confirmation that the selected subscription allows result storage, and an AI budget. The key is currently missing. Search caps and spacing apply. Brave's previously inspected published Search rate was $5/1,000 requests ($0.005/request); verify current pricing and storage rights at https://brave.com/search/api/ before choosing a plan. No search costs apply in supplied mode.
