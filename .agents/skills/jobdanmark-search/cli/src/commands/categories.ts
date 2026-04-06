import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface Category {
  id: number
  title: string
  helpText: string
  count: number
}

export const categories = defineCommand({
  name: "categories",
  description: "List all job categories with live counts from Jobdanmark.dk",
  options: {
    limit: option(z.coerce.number().optional(), { description: "Cap number of categories returned" }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), { description: "Output format" }),
  },
  handler: async ({ flags, output }) => {
    let data: Category[]
    try {
      data = await apiFetch<Category[]>("/api/categorycount/getcounts")
    } catch (err) {
      writeError(String(err), "API_ERROR")
      process.exit(1)
    }

    const result = flags.limit ? data.slice(0, flags.limit) : data
    output(result)
  },
})
