import { readFileSync } from "fs";
import { join } from "path";

const TEMPLATES_DIR = join(import.meta.dir, "..", "nomad", "templates");

// Variables that Nomad resolves at runtime — never substitute these.
const NOMAD_VAR_PREFIX = "NOMAD_";

// Allowed service types — prevents path traversal via service_type field.
const ALLOWED_SERVICE_TYPES = new Set(["ironclaw", "ironclaw-dind", "openclaw", "backup", "restore"]);

/** Sanitize a value for safe embedding in HCL double-quoted strings.
 *  Escapes characters that could break out of an HCL "..." value. */
function sanitizeHclValue(value: string): string {
  return value.replace(/[\\"$\n\r\t]/g, (ch) => {
    switch (ch) {
      case "\\": return "\\\\";
      case '"': return '\\"';
      case "$": return "$$";
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\t": return "\\t";
      default: return ch;
    }
  });
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    if (name.startsWith(NOMAD_VAR_PREFIX)) return `\${${name}}`;
    if (name in vars) return sanitizeHclValue(vars[name]);
    throw new Error(`Missing required template variable: ${name}`);
  });
}

export function renderJobTemplate(serviceType: string, vars: Record<string, string>): string {
  if (!ALLOWED_SERVICE_TYPES.has(serviceType)) {
    throw new Error(`Unknown service type: ${serviceType}`);
  }
  const templatePath = join(TEMPLATES_DIR, `${serviceType}.nomad.hcl`);
  const template = readFileSync(templatePath, "utf-8");
  return renderTemplate(template, vars);
}
