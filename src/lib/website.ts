import "server-only";
import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
export async function readPublicWebsite(address: string): Promise<string> {
  const original = new URL(address);
  async function visit(url: URL, depth: number): Promise<string> {
    if (
      depth > 3 ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname !== original.hostname ||
      !["", "80", "443"].includes(url.port)
    )
      throw new Error("Adresă web nepermisă.");
    const records = await lookup(url.hostname, { all: true });
    if (
      !records.length ||
      records.some((r) => ipaddr.process(r.address).range() !== "unicast")
    )
      throw new Error("Sunt permise numai site-uri publice.");
    const pinned = records[0];
    const result = await new Promise<{
      status: number;
      location?: string;
      body: string;
    }>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.get(
        url,
        {
          family: pinned.family,
          headers: {
            "User-Agent": "VoxaGrowth/1.0 (public business research)",
            Accept: "text/html",
          },
          lookup: (_host, _options, callback) =>
            callback(null, pinned.address, pinned.family),
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            res.resume();
            resolve({
              status: res.statusCode,
              location: res.headers.location,
              body: "",
            });
            return;
          }
          if (!(res.headers["content-type"] || "").includes("text/html")) {
            res.resume();
            reject(new Error("Site-ul nu a returnat HTML."));
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) {
              req.destroy(new Error("Pagina depășește limita de analiză."));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode || 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", reject);
        },
      );
      req.setTimeout(12000, () =>
        req.destroy(new Error("Site-ul nu răspunde.")),
      );
      req.on("error", reject);
    });
    if (result.location) return visit(new URL(result.location, url), depth + 1);
    if (result.status !== 200) throw new Error(`Site: HTTP ${result.status}`);
    const $ = load(result.body);
    $("script,style,noscript,iframe,svg").remove();
    return $("body").text().replace(/\s+/g, " ").trim().slice(0, 22000);
  }
  return visit(original, 0);
}
