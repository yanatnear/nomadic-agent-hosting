import { readFileSync } from "fs";
import { join } from "path";

const TEMPLATES_DIR = join(import.meta.dir, "..", "nomad", "templates");

// Variables that Nomad resolves at runtime — never substitute these.
const NOMAD_VAR_PREFIX = "NOMAD_";

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    if (name.startsWith(NOMAD_VAR_PREFIX)) return `\${${name}}`;
    if (name in vars) return vars[name];
    throw new Error(`Missing required template variable: ${name}`);
  });
}

export function renderJobTemplate(serviceType: string, vars: Record<string, string>): string {
  const templatePath = join(TEMPLATES_DIR, `${serviceType}.nomad.hcl`);
  const template = readFileSync(templatePath, "utf-8");
  return renderTemplate(template, vars);
}
