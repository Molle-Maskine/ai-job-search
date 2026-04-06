import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { htmlFetch, writeError, BASE_URL } from "../helpers.js"

interface JobindexAddress {
  city: string
  zipcode: string
  line: string
}

interface JobindexCompany {
  name: string
  homeurl: string | null
  logo: string | null
}

interface JobindexResult {
  tid: string
  headline: string
  company: JobindexCompany
  area: string
  firstdate: string
  url: string
  share_url: string
  companytext: string
}

interface JobindexSearchResponse {
  hitcount: number
  results: JobindexResult[]
  total_pages: number
  page_size: number
}

interface JobindexStash {
  "jobsearch/result_app": {
    storeData: {
      searchResponse: JobindexSearchResponse
    }
  }
}

function extractStash(html: string): JobindexStash | null {
  const stashStart = html.indexOf("var Stash = ")
  if (stashStart < 0) return null
  const scriptEnd = html.indexOf("//]]>", stashStart)
  if (scriptEnd < 0) return null
  const stashRaw = html.substring(stashStart + "var Stash = ".length, scriptEnd).trim().replace(/;$/, "").trim()
  try {
    return JSON.parse(stashRaw) as JobindexStash
  } catch {
    return null
  }
}

export const search = defineCommand({
  name: "search",
  description: "Search for jobs on Jobindex.dk",
  options: {
    query: option(z.string().optional(), { short: "q", description: "Search query (job title, keywords)" }),
    jobage: option(z.coerce.number().default(9999), { description: "Max age of job posting in days (default: all time)" }),
    sort: option(z.enum(["score", "date"]).default("score"), { description: "Sort order: score (relevance) or date (newest)" }),
    area: option(z.string().optional(), { description: "Area slug, e.g. storkoebenhavn" }),
    page: option(z.coerce.number().default(1), { description: "Page number (1-indexed)" }),
    limit: option(z.coerce.number().optional(), { description: "Max number of results to return" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    const params = new URLSearchParams()
    if (flags.query) params.set("q", flags.query)
    params.set("jobage", String(flags.jobage))
    params.set("sort", flags.sort)
    if (flags.area) params.set("area", flags.area)
    // page=0 returns 404; page=1 is the default (no param needed)
    if (flags.page > 1) params.set("page", String(flags.page))

    const url = `${BASE_URL}/jobsoegning?${params.toString()}`

    let html: string
    try {
      html = await htmlFetch(url)
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    const stash = extractStash(html)
    if (!stash) {
      writeError("Failed to parse job search results from page", "PARSE_ERROR")
      process.exit(1)
    }

    const searchResponse = stash["jobsearch/result_app"]?.storeData?.searchResponse
    if (!searchResponse) {
      writeError("No search response found in page data", "PARSE_ERROR")
      process.exit(1)
    }

    let results = searchResponse.results
    if (flags.limit) results = results.slice(0, flags.limit)

    const jobs = results.map((job) => ({
      id: job.tid,
      title: job.headline ?? "",
      company: job.company?.name ?? "",
      location: job.area ?? "",
      url: job.share_url ?? job.url ?? `${BASE_URL}/vis-job/${job.tid}`,
      description: "",
      posted_at: job.firstdate ?? undefined,
    }))

    output(jobs)
  },
})
