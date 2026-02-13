import { AgentAdapter } from "./base.js";
import { AntigravityAdapter } from "./antigravity.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import { VscodeAdapter } from "./vscode.js";

export function getAdapters(): AgentAdapter[] {
  return [
    new CodexAdapter(),
    new GeminiAdapter(),
    new ClaudeAdapter(),
    new VscodeAdapter(),
    new AntigravityAdapter()
  ];
}
