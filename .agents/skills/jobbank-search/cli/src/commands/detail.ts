import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { fetchWithUA, writeError, BASE_URL } from "../helpers.js"

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

interface JobLd {
  "@type": string
  title?: string
  description?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  url?: string
  identifier?: {
    "@type"?: string
    name?: string
    value?: string | number
  }
  hiringOrganization?: {
    name?: string
    logo?: string
  }
  jobLocation?: {
    address?: {
      streetAddress?: string
      addressLocality?: string
      postalCode?: string
      addressCountry?: string
    }
  }
}

export const detail = defineCommand({
  name: "detail",
  description: "Fetch full details for a single Jobbank.dk job posting by ID",
  options: {
    id: option(z.string(), { description: "Numeric job ID from search results" }),
    format: option(z.enum(["json", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.id) {
      writeError("--id is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const url = `${BASE_URL}/job/${flags.id}/`

    let html: string
    try {
      const response = await fetchWithUA(url)
      if (response.status === 404) {
        writeError("Job not found", "NOT_FOUND")
        process.exit(1)
      }
      if (!response.ok) {
        writeError(`Request failed: ${response.status} ${response.statusText}`, "API_ERROR")
        process.exit(1)
      }
      html = await response.text()
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    // Extract JSON-LD
    const jsonLdMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    let jobLd: JobLd | null = null

    for (const match of jsonLdMatches) {
      try {
        // Fix raw newlines inside string values (invalid JSON but common in HTML-embedded JSON-LD)
        const rawJson = match[1]
        let sanitized = ""
        let insideStr = false
        let esc = false
        for (let ci = 0; ci < rawJson.length; ci++) {
          const ch = rawJson[ci]
          const code = rawJson.charCodeAt(ci)
          if (esc) { sanitized += ch; esc = false; continue }
          if (code === 92 && insideStr) { sanitized += ch; esc = true; continue }
          if (code === 34) { insideStr = !insideStr; sanitized += ch; continue }
          if (insideStr && (code === 10 || code === 13)) {
            if (code === 13 && rawJson.charCodeAt(ci + 1) === 10) continue // skip CR in CRLF
            sanitized += "\\n"
            continue
          }
          sanitized += ch
        }
        const parsed = JSON.parse(sanitized)
        const obj = Array.isArray(parsed) ? parsed.find((o) => o["@type"] === "JobPosting") : parsed
        if (obj && obj["@type"] === "JobPosting") {
          jobLd = obj as JobLd
          break
        }
      } catch {
        // ignore parse errors
      }
    }

    if (!jobLd) {
      writeError("No JSON-LD found on job page", "PARSE_ERROR")
      process.exit(1)
    }

    const addr = jobLd.jobLocation?.address
    const rawDescription = jobLd.description ?? ""
    const description = flags.format === "plain" ? stripHtml(rawDescription) : rawDescription

    // Extract ID from identifier or from the input flag
    const id = jobLd.identifier?.value != null
      ? String(jobLd.identifier.value)
      : flags.id

    // Normalize validThrough — may be full ISO string, take just the date
    let deadline: string | null = null
    if (jobLd.validThrough) {
      const d = new Date(jobLd.validThrough)
      if (!isNaN(d.getTime())) {
        deadline = d.toISOString().split("T")[0]
      } else {
        deadline = jobLd.validThrough
      }
    }

    const result = {
      id,
      url: jobLd.url ?? url,
      title: jobLd.title ?? "",
      description,
      datePosted: jobLd.datePosted ?? null,
      deadline,
      employmentType: Array.isArray(jobLd.employmentType)
        ? jobLd.employmentType
        : jobLd.employmentType
        ? [jobLd.employmentType]
        : [],
      company: {
        name: jobLd.hiringOrganization?.name ?? "",
        logo: jobLd.hiringOrganization?.logo ?? null,
      },
      location: {
        streetAddress: addr?.streetAddress ?? "",
        city: addr?.addressLocality ?? "",
        postalCode: addr?.postalCode ?? "",
        country: addr?.addressCountry ?? "",
      },
    }

    output(result)
  },
})
