import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface OccupationAlias {
  aliasIdentifier: string
  conceptUriDa: string
  alternativeLabelDa: string
}

interface Occupation {
  conceptUriDa: string
  preferredLabelDa: string
  aliases: OccupationAlias[]
}

export const occupations = defineCommand({
  name: "occupations",
  description: "Search occupation types for building search filters",
  options: {
    "search-string": option(z.string(), { description: "Search term for occupation, e.g. sygeplejerske" }),
    "per-page": option(z.coerce.number().default(10), { description: "Max results to return" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    if (!flags["search-string"]) {
      writeError("--search-string is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const params: Record<string, string> = {
      SearchString: flags["search-string"],
      ResultsPerPage: String(flags["per-page"]),
    }

    let data: Occupation[]
    try {
      data = await apiFetch<Occupation[]>("/OccupationSearch", params)
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    output(data)
  },
})
