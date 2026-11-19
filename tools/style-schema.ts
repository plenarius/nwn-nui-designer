/**
 * Writes styles/style.schema.json, the JSON Schema of a style file, from the generic rules (src/core/edit/styles/
 * generic.ts): `pnpm style:schema`. tests/styles.test.ts checks the committed file is what this writes.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERIC_RULES } from "../src/core/edit/styles/generic.js";
import { REPO_ROOT } from "../src/node/settings.js";

const PARAM: Record<string, object> = {
  number: { type: "number" },
  numbers: { type: "array", items: { type: "number" }, minItems: 1 },
  strings: { type: "array", items: { type: "string" } },
  string: { type: "string", minLength: 1 },
  colours: { type: "array", items: { type: "array", items: { type: "integer", minimum: 0, maximum: 255 }, minItems: 3, maxItems: 3 } },
};

export function styleSchema(): object {
  const common = {
    $comment: { type: "string" },
    enabled: { type: "boolean", description: "false turns the rule off (a rule not listed is off too).", default: true },
    severity: { enum: ["error", "warning", "info"], description: "The severity of every note the rule makes (default: the rule's own)." },
    exempt: { type: "array", items: { type: "string" }, description: "Windows the rule skips, by name: the form or document name, or a framework window's id." },
    title: { type: "string", minLength: 1, description: "The rule's name in the problem list (default: made from its parameters)." },
    summary: { type: "string", minLength: 1, description: "One line saying what the rule wants, for the editor's rule list." },
  };
  const rules: Record<string, object> = {};
  for (const r of GENERIC_RULES) {
    const params = Object.fromEntries(Object.entries(r.params).map(([k, p]) => [k, { ...PARAM[p.kind], description: p.description, default: p.default }]));
    rules[r.id] = { description: `${r.description} Default severity: ${r.severity}.`, oneOf: [{ type: "boolean" }, { type: "object", additionalProperties: false, properties: { ...common, ...params } }] };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/plenarius/nwn-nui-designer/styles/style.schema.json",
    title: "NUI designer style file",
    description: "A house style for NUI windows: which generic rules to run, with their numbers (README, \"Your own house style\").",
    type: "object",
    additionalProperties: false,
    required: ["id", "title"],
    properties: {
      $schema: { type: "string" },
      $comment: { type: "string" },
      id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]*$", description: "The style's id: what `pnpm check --style ID` takes and the editor remembers." },
      title: { type: "string", minLength: 1, description: "The name in the editor's Style select." },
      description: { type: "string", description: "One or two sentences on the style, shown above its rules." },
      source: { type: "string", description: "Where the house style is written down." },
      knownWindowKeys: { type: "array", items: { type: "string" }, description: "Window keys your framework adds that the client ignores: the client check stops calling them unknown." },
      plugin: { type: "string", pattern: "\\.m?js$", description: "A .js or .mjs file beside this one (or below it) whose default export adds rules of your own. It is code: it runs with your rights, as any plugin." },
      rules: {
        type: "object",
        description: "The rules to run, by id: true, false, or an object of settings and parameters. A rule not listed is off. With a plugin, its rules' ids take the common settings too.",
        properties: rules,
        additionalProperties: { type: "object", properties: common, description: "A plugin's rule: its common settings." },
      },
    },
  };
}

export const SCHEMA_PATH = join(REPO_ROOT, "styles", "style.schema.json");

if (process.argv[1]?.endsWith("style-schema.ts")) {
  writeFileSync(SCHEMA_PATH, JSON.stringify(styleSchema(), null, 2) + "\n");
  console.log(`wrote ${SCHEMA_PATH}`);
}
