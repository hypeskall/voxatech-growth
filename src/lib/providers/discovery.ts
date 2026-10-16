import "server-only";
import { z } from "zod";
import { domainOf } from "../autopilot-policy";
export interface DiscoveryProvider {
  search(input: {
    city: string;
    specialty: string;
    offset: number;
  }): Promise<{ url: string; domain: string; title: string }[]>;
}
const responseSchema = z.object({
  web: z
    .object({
      results: z.array(z.object({ url: z.url(), title: z.string() })).max(30),
    })
    .optional(),
});
export class BraveSearchProvider implements DiscoveryProvider {
  async search(input: { city: string; specialty: string; offset: number }) {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key)
      throw new Error(
        "Adaugă BRAVE_SEARCH_API_KEY în proiectul Vercel voxa-growth.",
      );
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({
      q: `clinică ${input.specialty} ${input.city} România site oficial contact -site:facebook.com -site:instagram.com`,
      country: "RO",
      search_lang: "ro",
      count: "20",
      offset: String(Math.min(9, input.offset)),
      safesearch: "moderate",
    }).toString();
    const response = await fetch(url, {
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        `Brave Search HTTP ${response.status}. Verifică cheia, planul și limita de cereri${response.status === 429 ? "; se reîncearcă cu backoff" : ""}.`,
      );
    const json = responseSchema.parse(await response.json());
    const blocked =
      /(^|\.)(facebook\.com|instagram\.com|google\.com|youtube\.com|medici\.ro|docbook\.ro|reginamaria\.ro)$/;
    const seen = new Set<string>();
    return (json.web?.results || []).flatMap((item) => {
      const domain = domainOf(item.url);
      if (!domain || blocked.test(domain) || seen.has(domain)) return [];
      seen.add(domain);
      return [
        {
          url: new URL(item.url).origin,
          domain,
          title: item.title.slice(0, 250),
        },
      ];
    });
  }
}
