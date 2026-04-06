import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

export const suggestions = defineCommand({
  name: "suggestions",
  description: "Typeahead suggestions for job title/keyword search",
  options: {
    query: option(z.string(), { short: "q", description: "Partial search string to complete" }),
    limit: option(z.coerce.number().optional(), { description: "Cap number of suggestions returned" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.query) {
      writeError("--query is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const params: Record<string, string> = {
      query: flags.query,
    }

    let data: string[]
    try {
      data = await apiFetch<string[]>("/FindJob/GetTypeaheadSuggestions", params)
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    const result = flags.limit ? data.slice(0, flags.limit) : data
    output(result)
  },
})
