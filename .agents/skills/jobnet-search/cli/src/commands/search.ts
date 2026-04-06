import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface JobnetSearchResult {
  jobAdId: string
  title: string
  hiringOrgName: string
  municipality: string
  postalDistrictName: string
  country: string
  publicationDate: string
  applicationDeadline: string | null
  workHourPartTime: boolean
  isExternal: boolean
  hasLogo: boolean
  logoUrl: string
  cvr: string
  workPlaceAddress: string
  occupation?: string
  postalCode?: number
}

interface JobnetSearchResponse {
  meta: {
    totalJobAdCount: number
    pageNumber: number
    resultsPerPage: number
    searchString: string
  }
  facets: Record<string, unknown>
  results: JobnetSearchResult[]
}

export const search = defineCommand({
  name: "search",
  description: "Search for job ads on Jobnet.dk",
  options: {
    "search-string": option(z.string().optional(), { description: "Free-text keyword search (job title, skills, employer)" }),
    region: option(z.string().optional(), { description: "Region: HovedstadenOgBornholm, Midtjylland, Syddanmark, OevrigeSjaelland, Nordjylland" }),
    "postal-code": option(z.string().optional(), { description: "Postal code for radius search, e.g. 2100" }),
    radius: option(z.coerce.number().default(50), { description: "Radius in km from postal code (default: 50)" }),
    "work-hours": option(z.string().optional(), { description: "FullTime or PartTime" }),
    duration: option(z.string().optional(), { description: "Permanent or Temporary" }),
    "job-type": option(z.string().optional(), { description: "Announcement type: Ordinaert, Efterloenner, Foertidspension" }),
    "occupation-area": option(z.string().optional(), { description: "Occupation area identifier, e.g. 10000" }),
    "occupation-group": option(z.string().optional(), { description: "Occupation group identifier, e.g. 10060" }),
    page: option(z.coerce.number().default(1), { description: "Page number (1-indexed)" }),
    "per-page": option(z.coerce.number().default(10), { description: "Results per page" }),
    limit: option(z.coerce.number().optional(), { description: "Cap total results returned" }),
    order: option(z.string().default("PublicationDate"), { description: "Sort order: PublicationDate, BestMatch, ApplicationDate" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    const params: Record<string, string> = {}

    if (flags["search-string"]) params["SearchString"] = flags["search-string"]
    if (flags.region) params["Region"] = flags.region
    if (flags["postal-code"]) {
      params["PostalCode"] = flags["postal-code"]
      params["Radius"] = String(flags.radius)
    }
    if (flags["work-hours"]) params["WorkHours"] = flags["work-hours"]
    if (flags.duration) params["Duration"] = flags.duration
    if (flags["job-type"]) params["JobType"] = flags["job-type"]
    if (flags["occupation-area"]) params["OccupationArea"] = flags["occupation-area"]
    if (flags["occupation-group"]) params["OccupationGroup"] = flags["occupation-group"]

    params["PageNumber"] = String(flags.page)
    params["ResultsPerPage"] = String(flags["per-page"])
    params["SortOrder"] = flags.order

    let data: JobnetSearchResponse
    try {
      data = await apiFetch<JobnetSearchResponse>("/FindJob/Search", params)
    } catch (err) {
      const msg = String(err)
      // Error 2002 indicates a server-side issue — often geo-restricted or requires login
      if (msg.includes("400")) {
        writeError(
          "Jobnet search returned 400 — the FindJob/Search endpoint may require Danish IP or authentication. Try the 'suggestions' command to verify connectivity.",
          "API_ERROR"
        )
      } else {
        writeError(msg, "API_ERROR")
      }
      process.exit(1)
    }

    let results = data.results
    if (flags.limit) results = results.slice(0, flags.limit)

    const jobs = results.map((job) => ({
      id: job.jobAdId,
      title: job.title,
      company: job.hiringOrgName ?? "",
      location: [job.postalDistrictName, job.municipality].filter(Boolean).find(Boolean) ?? job.country ?? "",
      url: `https://jobnet.dk/job/${job.jobAdId}`,
      description: "",
      posted_at: job.publicationDate ?? undefined,
    }))

    output(jobs)
  },
})
