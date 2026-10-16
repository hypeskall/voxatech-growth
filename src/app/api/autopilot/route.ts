import { session } from "@/lib/session";
import { admin, check, appUrl, safeError, log } from "@/lib/db";
import { autopilotInput, nextBudgetDay } from "@/lib/autopilot-policy";
import { autopilotConfigurationErrors, runAutopilot } from "@/lib/autopilot";
import { z } from "zod";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET() {
  const s = await session();
  if (!s)
    return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  try {
    const [cfg, runs, candidates, usage, jobs, scheduler, leads] =
      await Promise.all([
        s.db
          .from("autopilot_settings")
          .select("*")
          .eq("organization_id", s.org)
          .single(),
        admin().rpc("autopilot_run_metrics", { org: s.org }),
        s.db
          .from("autopilot_candidates")
          .select("*")
          .eq("organization_id", s.org)
          .order("created_at", { ascending: false })
          .limit(2000),
        s.db
          .from("autopilot_usage")
          .select("*")
          .eq("organization_id", s.org)
          .order("day", { ascending: false })
          .limit(30),
        s.db
          .from("automation_jobs")
          .select(
            "id,kind,status,attempts,last_error,next_action_at,completed_at,payload",
          )
          .eq("organization_id", s.org)
          .like("kind", "autopilot_%")
          .order("created_at", { ascending: false })
          .limit(2000),
        admin().rpc("autopilot_scheduler_status", {}),
        s.db
          .from("leads")
          .select(
            "id,company_name,website,email,phone,source,status,do_not_contact,deleted_at",
          )
          .eq("organization_id", s.org)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
    const settings = check(cfg);
    const schedule = check(scheduler);
    const nextWake =
      settings.enabled && (schedule as { enabled?: boolean }).enabled
        ? new Date((Math.floor(Date.now() / 300000) + 1) * 300000).toISOString()
        : null;
    return Response.json(
      {
        settings,
        leads: check(leads).filter(
          (l) =>
            !l.deleted_at &&
            !l.do_not_contact &&
            !["LOST", "DO_NOT_CONTACT"].includes(l.status) &&
            !/demo|synthetic|dry.run|controlled.test/i.test(l.source || ""),
        ),
        replyTo: "contact@voxatech.ro",
        runs: check(runs),
        candidates: check(candidates),
        usage: check(usage),
        jobs: check(jobs),
        scheduler: schedule,
        nextWake,
        day: nextBudgetDay(),
        errors: autopilotConfigurationErrors(settings),
        canManage: ["owner", "admin"].includes(s.role),
        providerConfigured: !!process.env.BRAVE_SEARCH_API_KEY,
        delivery: process.env.EMAIL_DELIVERY_MODE,
        metricsScope: "production-autopilot-only",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 500 });
  }
}
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(appUrl()).origin)
    return Response.json({ error: "Origine nepermisă." }, { status: 403 });
  const s = await session();
  if (!s || !["owner", "admin"].includes(s.role))
    return Response.json(
      { error: "Numai administratorii pot modifica Autopilot." },
      { status: 403 },
    );
  try {
    const raw = await req.text();
    if (raw.length > 12000)
      return Response.json({ error: "Date prea mari." }, { status: 413 });
    const { action, data } = z
      .object({
        action: z.enum(["save", "start", "pause", "process"]),
        data: z.unknown().optional(),
      })
      .parse(JSON.parse(raw));
    if (action === "save") {
      const input = autopilotInput.parse(data);
      if (input.selected_lead_ids.length) {
        const selected = check(
          await s.db
            .from("leads")
            .select("id,do_not_contact,status,website,source,deleted_at")
            .eq("organization_id", s.org)
            .in("id", input.selected_lead_ids),
        );
        if (
          selected.length !== new Set(input.selected_lead_ids).size ||
          selected.some(
            (l) =>
              l.deleted_at ||
              l.do_not_contact ||
              ["LOST", "DO_NOT_CONTACT"].includes(l.status) ||
              (input.require_website &&
                !/^https?:\/\//.test(l.website || "")) ||
              /demo|synthetic|dry.run|controlled.test/i.test(l.source || ""),
          )
        )
          throw new Error(
            "Selecția conține leaduri indisponibile, fără site, demo sau din altă organizație.",
          );
      }
      check(
        await admin()
          .from("autopilot_settings")
          .update({
            ...input,
            enabled: false,
            last_error: null,
          })
          .eq("organization_id", s.org),
      );
    } else if (action === "start") {
      const cfg = check(
        await admin()
          .from("autopilot_settings")
          .select("*")
          .eq("organization_id", s.org)
          .single(),
      );
      const errors = autopilotConfigurationErrors(cfg);
      const scheduler = check(
        await admin().rpc("autopilot_scheduler_status", {}),
      ) as { enabled?: boolean };
      if (!scheduler.enabled || !process.env.AUTOPILOT_CRON_SECRET)
        errors.push(
          "Scheduler neconfigurat; rulează scripts/configure-autopilot-scheduler.mjs.",
        );
      if (errors.length) throw new Error(errors.join(" "));
      check(
        await admin()
          .from("autopilot_settings")
          .update({ enabled: true, last_error: null })
          .eq("organization_id", s.org),
      );
      check(await admin().rpc("schedule_autopilot", { target_org: s.org }));
    } else if (action === "pause") {
      check(
        await admin()
          .from("autopilot_settings")
          .update({ enabled: false })
          .eq("organization_id", s.org),
      );
    } else return Response.json(await runAutopilot(s.org));
    await log(
      s.org,
      `autopilot_${action}`,
      null,
      { draft_only: true },
      null,
      s.user.id,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 400 });
  }
}
