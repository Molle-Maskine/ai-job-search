import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { htmlFetch, writeError, BASE_URL } from "../helpers.js"

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
  description: "Fetch full details for a single Jobindex job ad by ID",
  options: {
    id: option(z.string(), { description: "Job ad ID (e.g. h1234567 or r1234567)" }),
    format: option(z.enum(["json", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.id) {
      writeError("--id is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    // Step 1: Fetch /vis-job/{id} to find the full jobannonce URL (with slug)
    const visJobUrl = `${BASE_URL}/vis-job/${flags.id}`
    let visHtml: string
    try {
      visHtml = await htmlFetch(visJobUrl)
    } catch (err) {
      const msg = String(err)
      if (msg.includes("Job not found") || msg.includes("404")) {
        writeError("Job not found", "NOT_FOUND")
      } else {
        writeError(msg, "API_ERROR")
      }
      process.exit(1)
    }

    // Extract the full /jobannonce/{id}/{slug} URL from the vis-job page
    const jobannonceLinkMatch = visHtml.match(
      new RegExp(`href="(https://www\\.jobindex\\.dk/jobannonce/${flags.id}/[^"]+)"`)
    )
    const fullUrl = jobannonceLinkMatch ? jobannonceLinkMatch[1] : visJobUrl

    // Step 2: Fetch the full jobannonce page to get the description
    let html: string
    if (jobannonceLinkMatch) {
      try {
        html = await htmlFetch(fullUrl)
      } catch {
        // Fall back to vis-job HTML
        html = visHtml
      }
    } else {
      // External job — use the vis-job HTML
      html = visHtml
    }

    // Extract title from <title> or <h1>
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    let title = titleMatch ? stripHtml(titleMatch[1]) : ""
    // Remove "Job ad:" prefix from page title
    title = title.replace(/^Job ad:\s*/i, "").trim()

    // Extract company from metadata-item or toolbar
    let company = ""
    const metaItemMatch = html.match(/class="jobtext-jobad__metadata-item"[^>]*>([\s\S]*?)<\/div>/i)
    if (metaItemMatch) {
      company = stripHtml(metaItemMatch[1])
    }
    if (!company) {
      const companyToolbarMatch = html.match(/class="jix-toolbar-top__company"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
      if (companyToolbarMatch) company = stripHtml(companyToolbarMatch[1])
    }

    // Extract location
    let location = ""
    const locMatch = html.match(/class="jix_robotjob--area"[^>]*>([\s\S]*?)<\/span>/i) ||
                    html.match(/class="jobtext-jobad__metadata-item"[\s\S]*?aria-label="Lokation"[^>]*>([\s\S]*?)<\/div>/i)
    if (locMatch) location = stripHtml(locMatch[1])

    // Extract date
    const dateMatch = html.match(/<time[^>]+datetime="([^"]+)"/)
    const posted_at = dateMatch ? dateMatch[1] : undefined

    // Extract job description body
    let descriptionHtml = ""
    const bodyMatch = html.match(/class="jobtext-jobad__body"[^>]*>([\s\S]*?)<\/div>\s*<div class="jobtext-jobad__sidebar/i)
    if (bodyMatch) {
      descriptionHtml = bodyMatch[1].trim()
    } else {
      // Fallback: PaidJob-inner or article
      const fallbackMatch =
        html.match(/class="PaidJob-inner"[^>]*>([\s\S]*?)(?=<div class="jix_toolbar jix_appetizer_toolbar|<div class="my-4)/i) ||
        html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
      if (fallbackMatch) descriptionHtml = fallbackMatch[1].trim()
    }

    const description = flags.format === "plain" ? stripHtml(descriptionHtml) : descriptionHtml

    const result = {
      id: flags.id,
      url: fullUrl,
      title,
      company,
      location,
      description,
      posted_at,
    }

    output(result)
  },
})
