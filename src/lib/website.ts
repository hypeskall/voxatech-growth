import "server-only";
import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
export async function readPublicWebsiteDocument(address: string) {
  const original = new URL(address);
  const deadline = Date.now() + 14000;
  async function visit(
    url: URL,
    depth: number,
  ): Promise<{
    url: string;
    title: string;
    text: string;
    emails: string[];
    phones: string[];
    contactUrls: string[];
  }> {
    if (
      depth > 3 ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname !== original.hostname ||
      !["", "80", "443"].includes(url.port)
    )
      throw new Error("Adresă web nepermisă.");
    const records = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("DNS timeout")), 3000);
        timer.unref();
      }),
    ]);
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
      if (Date.now() >= deadline) return reject(new Error("Website timeout"));
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
      const timer = setTimeout(
        () => req.destroy(new Error("Website deadline exceeded")),
        Math.max(1, deadline - Date.now()),
      );
      req.on("close", () => clearTimeout(timer));
    });
    if (result.location) return visit(new URL(result.location, url), depth + 1);
    if (result.status !== 200) throw new Error(`Site: HTTP ${result.status}`);
    const $ = load(result.body);
    $("script,style,noscript,iframe,svg").remove();
    const emails = $("a[href^='mailto:']")
      .map((_, el) => ($(el).attr("href") || "").slice(7).split("?")[0])
      .get();
    const phones = $("a[href^='tel:']")
      .map((_, el) => ($(el).attr("href") || "").slice(4))
      .get();
    const contactUrls = $("a[href]")
      .map((_, el) => {
        try {
          const link = new URL($(el).attr("href")!, url);
          return link.hostname === original.hostname &&
            /contact/i.test(link.pathname)
            ? link.href
            : null;
        } catch {
          return null;
        }
      })
      .get()
      .filter((v): v is string => !!v)
      .slice(0, 1);
    return {
      url: url.href,
      title: $("title").text().trim().slice(0, 250),
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 14000),
      emails,
      phones,
      contactUrls,
    };
  }
  return visit(original, 0);
}
export async function readPublicWebsite(address: string): Promise<string> {
  return (await readPublicWebsiteDocument(address)).text;
}
