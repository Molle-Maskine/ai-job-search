import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { writeError, stripHtml, BASE_URL } from "../helpers.js"

async function fetchHtml(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; jobdanmark-cli/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "da,en;q=0.9",
      },
      redirect: "follow",
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    if (response.status === 404) throw new Error("Job not found")
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

interface JobLocation {
  streetAddress: string | null
  addressLocality: string | null
  addressRegion: string | null
  postalCode: string | null
  addressCountry: string | null
}

interface JsonLdJob {
  "@type": string
  title?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  description?: string
  url?: string
  hiringOrganization?: {
    name?: string
    logo?: string
  }
  jobLocation?: {
    address?: JobLocation
  }
  identifier?: {
    value?: string
  }
}

export const detail = defineCommand({
  name: "detail",
  description: "Fetch full details for a single Jobdanmark job posting by slug",
  options: {
    slug: option(z.string(), { description: "Job slug from search results (e.g. it-chef-soeges-til-rah)" }),
    format: option(z.enum(["json", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.slug) {
      writeError("--slug is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const url = `${BASE_URL}/job/${flags.slug}`

    let html: string
    try {
      html = await fetchHtml(url)
    } catch (err) {
      const msg = String(err)
      if (msg.includes("Job not found") || msg.includes("404")) {
        writeError("Job not found", "NOT_FOUND")
      } else {
        writeError(msg, "API_ERROR")
      }
      process.exit(1)
    }

    // Extract JSON-LD blocks — type attribute may use HTML entity &#x2B; for "+"
    // The description field may contain </script> which breaks naive regex matching.
    // We find each script opening tag and extract JSON by counting braces.
    const scriptOpenRe = /<script[^>]+type="application\/ld(?:\+|&#x2B;)json"[^>]*>/gi
    let jobLd: JsonLdJob | null = null

    let scriptMatch: RegExpExecArray | null
    while ((scriptMatch = scriptOpenRe.exec(html)) !== null && !jobLd) {
      const contentStart = scriptMatch.index + scriptMatch[0].length
      // Find the JSON object by counting braces from the first '{' after the opening tag
      const jsonStart = html.indexOf("{", contentStart)
      if (jsonStart < 0) continue

      // Walk forward counting brace depth to find where the JSON ends
      let depth = 0
      let inString = false
      let escape = false
      let jsonEnd = -1
      for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i]
        if (escape) { escape = false; continue }
        if (ch === "\\" && inString) { escape = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === "{") depth++
        else if (ch === "}") {
          depth--
          if (depth === 0) { jsonEnd = i + 1; break }
        }
      }
      if (jsonEnd < 0) continue

      const jsonStr = html.substring(jsonStart, jsonEnd)
      try {
        // The JSON may contain raw newlines inside string values (invalid per JSON spec).
        // Strategy: replace raw newlines ONLY inside string values by walking the chars.
        // We re-build the string, escaping bare CR/LF only when inside a JSON string.
        let result = ""
        let insideStr = false
        let esc = false
        for (let ci = 0; ci < jsonStr.length; ci++) {
          const ch = jsonStr[ci]
          const code = jsonStr.charCodeAt(ci)
          if (esc) {
            result += ch
            esc = false
            continue
          }
          if (code === 92 && insideStr) {
            // backslash — next char is escaped
            result += ch
            esc = true
            continue
          }
          if (code === 34) {
            // double-quote toggles string mode
            insideStr = !insideStr
            result += ch
            continue
          }
          if (insideStr && (code === 10 || code === 13)) {
            // Raw newline inside string → replace with \n escape
            if (code === 13 && jsonStr.charCodeAt(ci + 1) === 10) {
              // CRLF: skip the CR, let LF be replaced next iteration
              continue
            }
            result += "\\n"
            continue
          }
          result += ch
        }
        const parsed = JSON.parse(result)
        const obj = Array.isArray(parsed) ? parsed.find((o: Record<string, unknown>) => o["@type"] === "JobPosting") : parsed
        if (obj && (obj as Record<string, unknown>)["@type"] === "JobPosting") {
          jobLd = obj as JsonLdJob
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
    const description = flags.format === "plain"
      ? stripHtml(jobLd.description ?? "")
      : (jobLd.description ?? "")

    const result = {
      slug: flags.slug,
      url,
      title: jobLd.title ?? "",
      datePosted: jobLd.datePosted ?? null,
      validThrough: jobLd.validThrough ?? null,
      employmentType: Array.isArray(jobLd.employmentType)
        ? jobLd.employmentType
        : jobLd.employmentType
        ? [jobLd.employmentType]
        : [],
      hiringOrganization: {
        name: jobLd.hiringOrganization?.name ?? "",
        logo: jobLd.hiringOrganization?.logo ?? null,
      },
      jobLocation: {
        streetAddress: addr?.streetAddress ?? null,
        addressLocality: addr?.addressLocality ?? null,
        addressRegion: addr?.addressRegion ?? null,
        postalCode: addr?.postalCode ?? null,
        addressCountry: addr?.addressCountry ?? null,
      },
      description,
    }

    output(result)
  },
})
