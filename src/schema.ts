import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

const schema = {
  type: "object",
  required: ["version", "mcp"],
  additionalProperties: false,
  properties: {
    version: { type: "string" },
    mcp: {
      type: "object",
      required: ["servers"],
      additionalProperties: false,
      properties: {
        servers: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["transport"],
            additionalProperties: false,
            properties: {
              transport: { enum: ["stdio", "sse", "http"] },
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
              url: { type: "string" },
              env: {
                type: "object",
                additionalProperties: { type: "string" }
              },
              headers: {
                type: "object",
                additionalProperties: { type: "string" }
              },
              startup_timeout_sec: { type: "number" },
              enabledIn: {
                type: "object",
                additionalProperties: false,
                properties: {
                  codex: { type: "boolean" },
                  gemini: { type: "boolean" },
                  claude: { type: "boolean" },
                  vscode: { type: "boolean" },
                  antigravity: { type: "boolean" }
                }
              }
            },
            allOf: [
              {
                if: { properties: { transport: { const: "stdio" } } },
                then: { required: ["command"] }
              },
              {
                if: { properties: { transport: { const: "sse" } } },
                then: { required: ["url"] }
              },
              {
                if: { properties: { transport: { const: "http" } } },
                then: { required: ["url"] }
              }
            ]
          }
        }
      }
    },
    skills: {
      type: "object",
      required: ["items"],
      additionalProperties: false,
      properties: {
        items: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              content: { type: "string" },
              sourcePath: { type: "string" },
              fileName: { type: "string" },
              enabledIn: {
                type: "object",
                additionalProperties: false,
                properties: {
                  codex: { type: "boolean" },
                  gemini: { type: "boolean" },
                  claude: { type: "boolean" },
                  vscode: { type: "boolean" },
                  antigravity: { type: "boolean" }
                }
              }
            },
            anyOf: [{ required: ["content"] }, { required: ["sourcePath"] }]
          }
        }
      }
    },
    targets: {
      type: "object",
      additionalProperties: false,
      properties: {
        codex: { $ref: "#/$defs/target" },
        gemini: { $ref: "#/$defs/target" },
        claude: { $ref: "#/$defs/target" },
        vscode: { $ref: "#/$defs/target" },
        antigravity: { $ref: "#/$defs/target" }
      }
    }
  },
  $defs: {
    target: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        allow: { type: "array", items: { type: "string" } },
        deny: { type: "array", items: { type: "string" } },
        outputPath: { type: "string" },
        skillsEnabled: { type: "boolean" },
        allowSkills: { type: "array", items: { type: "string" } },
        denySkills: { type: "array", items: { type: "string" } },
        skillsOutputDir: { type: "string" }
      }
    }
  }
} as const;

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

export interface ShapeValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateConfigShape(input: unknown): ShapeValidationResult {
  const ok = validate(input);
  if (ok) {
    return { ok: true, errors: [] };
  }

  const errors =
    validate.errors?.map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message || "invalid"}`) ??
    [];
  return { ok: false, errors };
}
