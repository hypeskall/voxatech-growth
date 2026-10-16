import { readFile } from "node:fs/promises";
const link = JSON.parse(
  await readFile(new URL("../.vercel/project.json", import.meta.url), "utf8"),
);
if (
  link.projectName !== "voxa-growth" ||
  link.projectId !== "prj_hNHB00Tsq2XqZ67nIFNTfamhHcrL"
)
  throw new Error("Wrong deployment project");
const auth = JSON.parse(
  await readFile(
    `${process.env.APPDATA}/com.vercel.cli/Data/auth.json`,
    "utf8",
  ),
);
const url = `https://api.vercel.com/v10/projects/${link.projectId}/env?teamId=${link.orgId}`;
const headers = {
  Authorization: `Bearer ${auth.token}`,
  "Content-Type": "application/json",
};
const response = await fetch(url, { headers });
if (!response.ok) throw new Error(`Environment read HTTP ${response.status}`);
const envs = (await response.json()).envs;
const mode = envs.find(
  (e) => e.key === "EMAIL_DELIVERY_MODE" && e.target.includes("production"),
);
if (!mode) throw new Error("Missing delivery mode");
const locked = await fetch(
  `https://api.vercel.com/v9/projects/${link.projectId}/env/${mode.id}?teamId=${link.orgId}`,
  {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      value: "log",
      type: "encrypted",
      target: ["production"],
    }),
  },
);
if (!locked.ok)
  throw new Error(`Delivery log configuration HTTP ${locked.status}`);
const existing = envs.find(
  (e) => e.key === "EMAIL_REPLY_TO" && e.target.includes("production"),
);
const r = await fetch(
  existing
    ? `https://api.vercel.com/v9/projects/${link.projectId}/env/${existing.id}?teamId=${link.orgId}`
    : url,
  {
    method: existing ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({
      key: "EMAIL_REPLY_TO",
      value: "contact@voxatech.ro",
      type: "encrypted",
      target: ["production"],
    }),
  },
);
if (!r.ok) throw new Error(`Reply configuration HTTP ${r.status}`);
console.log(
  JSON.stringify({
    project: link.projectName,
    replyTo: "contact@voxatech.ro",
    delivery: "log",
  }),
);
