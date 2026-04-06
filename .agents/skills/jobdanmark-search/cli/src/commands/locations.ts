import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface LocationItem {
  id: string
  text: string
  value: string
  category: string
}

interface LocationGroup {
  title: string
  items: LocationItem[]
}

export const locations = defineCommand({
  name: "locations",
  description: "Suggest municipalities, zip codes, and regions for a query on Jobdanmark.dk",
  options: {
    query: option(z.string(), { short: "q", description: "Location text to search (city, zip code, region)" }),
    limit: option(z.coerce.number().optional(), { description: "Cap total suggestions returned" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags.query) {
      writeError("--query is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    let data: LocationGroup[]
    try {
      data = await apiFetch<LocationGroup[]>("/api/search/locations", { q: flags.query })
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
