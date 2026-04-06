import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { rssFetch, parseRssDescription, extractJobIdFromUrl, writeError, fetchWithUA, BASE_URL } from "../helpers.js"

function normalizePubDate(pubDate: string): string {
  if (!pubDate) return ""
  try {
    return new Date(pubDate).toISOString()
  } catch {
    return pubDate
  }
}

async function fetchTotalCount(searchUrl: string): Promise<number | null> {
  try {
    const response = await fetchWithUA(searchUrl)
    if (!response.ok) return null
    const html = await response.text()
    const match = html.match(/(\d[\d.]*)\s+relevante\s+job/i)
    if (match) {
      return parseInt(match[1].replace(/\./g, ""), 10)
    }
    // Fallback: look for it in title
    const titleMatch = html.match(/<title[^>]*>([^<]*?(\d[\d.]*)\s+relevante[^<]*)<\/title>/i)
    if (titleMatch) {
      return parseInt(titleMatch[2].replace(/\./g, ""), 10)
    }
    return null
  } catch {
    return null
  }
}

export const search = defineCommand({
  name: "search",
  description: "Search job listings on Jobbank.dk via RSS feed",
  options: {
    query: option(z.string().optional(), { short: "q", description: "Keyword search (title, company, keyword)" }),
    exclude: option(z.string().optional(), { description: "Exclude keywords (antikey)" }),
    type: option(z.array(z.coerce.number()).optional(), { description: "Job type code(s), e.g. --type 3 (Fuldtidsjob). Repeatable." }),
    education: option(z.array(z.coerce.number()).optional(), { description: "Education field code(s). Repeatable." }),
    location: option(z.array(z.coerce.number()).optional(), { description: "Region code(s) (amt). Repeatable." }),
    "work-area": option(z.array(z.coerce.number()).optional(), { description: "Work area/function code(s) (erf). Repeatable." }),
    industry: option(z.array(z.coerce.number()).optional(), { description: "Industry code(s) (branche). Repeatable." }),
    "suitable-for": option(z.array(z.coerce.number()).optional(), { description: "Suitable-for code(s) (andet). Repeatable." }),
    company: option(z.coerce.number().optional(), { description: "Company ID (virk)" }),
    remote: option(z.string().optional(), { description: "Remote work: helt or delvist (fjernarbejde)" }),
    since: option(z.string().optional(), { description: "Posted on or after date YYYY-MM-DD (oprettet)" }),
    limit: option(z.coerce.number().optional(), { description: "Cap total results returned (client-side)" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    const params: Record<string, string | string[]> = {}

    if (flags.query) params["key"] = flags.query
    if (flags.exclude) params["antikey"] = flags.exclude
    if (flags.type?.length) params["cvtype"] = flags.type.map(String)
    if (flags.education?.length) params["udd"] = flags.education.map(String)
    if (flags.location?.length) params["amt"] = flags.location.map(String)
    if (flags["work-area"]?.length) params["erf"] = flags["work-area"].map(String)
    if (flags.industry?.length) params["branche"] = flags.industry.map(String)
    if (flags["suitable-for"]?.length) params["andet"] = flags["suitable-for"].map(String)
    if (flags.company) params["virk"] = String(flags.company)
    if (flags.remote) params["fjernarbejde"] = flags.remote
    if (flags.since) params["oprettet"] = flags.since

    let items
    try {
      items = await rssFetch(params)
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    if (flags.limit) items = items.slice(0, flags.limit)

    // Build HTML search URL for total count
    const searchParams = new URLSearchParams()
    if (flags.key) searchParams.set("q", flags.key)
    const htmlUrl = `${BASE_URL}/jobsoegning?${searchParams.toString()}`

    // Fetch total count in parallel with result processing
    const totalPromise = fetchTotalCount(htmlUrl)

    const results = items.map((item) => {
      const { company, location, jobType, deadline } = parseRssDescription(item.description)
      const id = extractJobIdFromUrl(item.link)
      return {
        id,
        title: item.title,
        company,
        location,
        url: item.link,
        description: item.description,
        posted_at: normalizePubDate(item.pubDate),
        jobType,
        deadline,
      }
    })

    const total = await totalPromise

    // Output as array for dashboard compatibility; meta is attached as non-enumerable if needed
    // The dashboard expects a JSON array, so output just the results
    void total // total is for informational purposes only
    output(results)
  },
})
