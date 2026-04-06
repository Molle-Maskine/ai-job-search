import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiPost, writeError, BASE_URL } from "../helpers.js"

interface SearchFilter {
  type: string
  value: string | number
  displayText: string
}

interface SearchRequestBody {
  jobTypes: string[]
  filters: SearchFilter[]
  locationMode: string
  distance: number
}

interface CompanyLogo {
  key: string
  url: string
  focalPoint: { top: number; left: number } | null
}

interface JobdanmarkResult {
  title: string
  companyName: string
  companyLogo: CompanyLogo | null
  companyAddress: string
  jobTypes: string[]
  boostJob: boolean
  publishedDate: string
  applicationDeadline: string | null
  url: string
  slug?: string
  coverImage: CompanyLogo | null
  silhouetteLogo: boolean
}

interface SearchResponse {
  currentPage: number
  totalItems: number
  itemsPrPage: number
  totalPages: number
  items: JobdanmarkResult[]
  // Legacy field names (in case API changes)
  meta?: {
    currentPage: number
    totalItems: number
    itemsPrPage: number
    totalPages: number
  }
  results?: JobdanmarkResult[]
}

function normalizeUrl(url: string): string {
  if (!url) return ""
  if (url.startsWith("http")) return url
  return `${BASE_URL}${url}`
}

function extractSlug(url: string): string {
  const match = url.match(/\/job\/([^/?#]+)/)
  return match ? match[1] : url
}

function parseDanishDate(dateStr: string | null): string | undefined {
  if (!dateStr) return undefined
  // Format: DD-MM-YYYY
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`
  }
  return dateStr
}

export const search = defineCommand({
  name: "search",
  description: "Search job listings on Jobdanmark.dk",
  options: {
    text: option(z.string().optional(), { short: "q", description: "Free-text keyword search" }),
    category: option(z.coerce.number().optional(), { description: "Category ID (e.g. 227978 for IT)" }),
    "jobtitle-id": option(z.coerce.number().optional(), { description: "Job title ID from autocomplete results" }),
    municipality: option(z.string().optional(), { description: "Municipality name, e.g. Odense, København" }),
    zip: option(z.string().optional(), { description: "Zip code, e.g. 5000" }),
    region: option(z.string().optional(), { description: "Region name" }),
    "job-type": option(z.string().optional(), { description: "Comma-separated job types: fuldtid,deltid,fleksjob,elev,studiejob,praktik" }),
    page: option(z.coerce.number().default(1), { description: "Page number (30 items per page)" }),
    limit: option(z.coerce.number().optional(), { description: "Cap total results returned (client-side)" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    const filters: SearchFilter[] = []

    if (flags.text) {
      filters.push({ type: "freetext", value: flags.text, displayText: flags.text })
    }
    if (flags.category) {
      filters.push({ type: "category", value: flags.category, displayText: String(flags.category) })
    }
    if (flags["jobtitle-id"]) {
      filters.push({ type: "jobtitle", value: flags["jobtitle-id"], displayText: String(flags["jobtitle-id"]) })
    }
    if (flags.municipality) {
      filters.push({ type: "municipality", value: flags.municipality, displayText: flags.municipality })
    }
    if (flags.zip) {
      filters.push({ type: "zip", value: flags.zip, displayText: flags.zip })
    }
    if (flags.region) {
      filters.push({ type: "region", value: flags.region, displayText: flags.region })
    }

    const jobTypes = flags["job-type"]
      ? flags["job-type"].split(",").map((t) => t.trim()).filter(Boolean)
      : []

    const body: SearchRequestBody = {
      jobTypes,
      filters,
      locationMode: "Text",
      distance: 50,
    }

    let data: SearchResponse
    try {
      data = await apiPost<SearchResponse>(`/api/jobsearch/search/${flags.page}`, body)
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    // API returns items (not results), handle both
    let results = (data.items ?? data.results) as JobdanmarkResult[]
    if (!results) results = []
    if (flags.limit) results = results.slice(0, flags.limit)

    const jobs = results.map((job) => {
      const fullUrl = normalizeUrl(job.url)
      const slug = job.slug ?? extractSlug(fullUrl)
      return {
        id: slug,
        title: job.title,
        company: job.companyName ?? "",
        location: job.companyAddress ?? "",
        url: fullUrl,
        description: "",
        posted_at: parseDanishDate(job.publishedDate),
      }
    })

    output(jobs)
  },
})
