import { redirect, notFound } from "next/navigation";
import { session } from "@/lib/session";
import { getSnapshot } from "@/lib/snapshot";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ route?: string[] }>;
}) {
  const { route } = await params;
  if (!route?.length) redirect("/dashboard");
  if (
    ![
      "dashboard",
      "autopilot",
      "leads",
      "campaigns",
      "inbox",
      "demos",
      "knowledge-base",
      "analytics",
      "settings",
    ].includes(route[0]) ||
    (route.length > 2 &&
      !(route[0] === "campaigns" && route.length === 3 && route[2] === "review"))
  )
    notFound();
  const s = await session();
  if (!s) redirect("/login");
  return (
    <Workspace
      key={route.join("/")}
      initial={await getSnapshot(s, route.join("/"))}
      path={route.join("/")}
    />
  );
}
