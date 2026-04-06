import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface AutocompleteItem {
  id: string
  text: string
  value: number
  category: string
  slug: string
}

interface AutocompleteGroup {
  title: string
  items: AutocompleteItem[]
}

export const autocomplete = defineCommand({
  name: "autocomplete",
  description: "Suggest job titles and categories for a query on Jobdanmark.dk",
  options: {
    query: option(z.string(), { short: "q", description: "Search text to autocomplete" }),
    limit: option(z.coerce.number().optional(), { description: "Cap total suggestions returned" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.query) {
      writeError("--query is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    let data: AutocompleteGroup[]
    try {
      data = await apiFetch<AutocompleteGroup[]>("/api/search/autocomplete", { q: flags.query })
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    if (flags.limit) {
      let remaining = flags.limit
      data = data.map((group) => ({
        ...group,
        items: group.items.slice(0, remaining).map((item) => {
          remaining--
          return item
        }),
      })).filter((group) => group.items.length > 0)
    }

    output(data)
  },
})
