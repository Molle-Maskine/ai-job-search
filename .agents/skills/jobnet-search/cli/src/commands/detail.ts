import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface JobnetDetail {
  id: string
  title: string
  body: string
  publicationDateTime: string
  unpublicationDateTime: string | null
  isAnonymousEmployer: boolean
  hasLogo: boolean
  logoUrl: string
  employer: {
    cvrNumber: string
    pNumber: string
    name: string
    hasCompanyLogo: boolean
  }
  job: {
    type: string
    address: {
      streetName: string
      city: string
      postalCode: string
      municipality: string
      countryCode: string
      countryName: string
    }
    noFixedWorkplace: boolean
    isLimitedPeriod: boolean
    isPartTime: boolean
    employmentDate: string | null
    preferredLabelDa: string | null
  }
  application: {
    deadlineDate: string | null
    availablePositions: number
    contactPersons: Array<{
      firstNames: string
      lastName: string
      phoneNumber: string
    }>
    url: string
    urlText: string
    isApplicationDeadlineASAP: boolean
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export const detail = defineCommand({
  name: "detail",
  description: "Fetch full details for a single Jobnet job ad by ID (UUID)",
  options: {
    id: option(z.string(), { description: "Job ad UUID from search results" }),
    format: option(z.enum(["json", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.id) {
      writeError("--id is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    let data: JobnetDetail
    try {
      data = await apiFetch<JobnetDetail>(`/FindJob/JobAdDetails/${flags.id}`, { incrementViews: "false" })
    } catch (err) {
      const msg = String(err)
      if (msg.includes("404") || msg.includes("not found")) {
        writeError("Job ad not found", "NOT_FOUND")
      } else {
        writeError(msg, "API_ERROR")
      }
      process.exit(1)
    }

    const description = flags.format === "plain" ? stripHtml(data.body ?? "") : (data.body ?? "")
    const location = [
      data.job?.address?.city,
      data.job?.address?.municipality,
    ].filter(Boolean).find(Boolean) ?? data.job?.address?.countryName ?? ""

    const result = {
      id: data.id,
      url: `https://jobnet.dk/job/${data.id}`,
      title: data.title,
      company: data.employer?.name ?? "",
      location,
      description,
      posted_at: data.publicationDateTime ?? undefined,
    }

    output(result)
  },
})
