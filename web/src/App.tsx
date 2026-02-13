import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";

type Agent = string;
type ModuleTab = "mcp" | "skills";
type ImportSourceHint = "auto" | "mcp_router_json" | "codex_toml" | "gemini_json" | "generic_mcp_json";
type NoticeKind = "idle" | "success" | "error";
type MatrixRow = Record<Agent, boolean>;
type MatrixMap = Record<string, MatrixRow>;

interface DiffInfo {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}
interface PlanItem {
  agent: Agent;
  path: string;
  skillsDir: string;
  mcp: DiffInfo;
  skills: DiffInfo;
}
interface SnapshotItem {
  id: string;
  meta: { createdAt: string; applied: Array<{ agent: Agent }> } | null;
}
interface UnifiedMcpServer {
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  startup_timeout_sec?: number;
}
interface UnifiedSkill {
  content?: string;
  sourcePath?: string;
  fileName?: string;
}
interface ImportPreviewResult {
  detectedFormat: string;
  servers: Record<string, UnifiedMcpServer>;
  conflicts: string[];
  envSuggestions: Array<{ serverId: string; fieldPath: string; envKey: string; replacement: string }>;
  warnings: Array<{ code: string; message: string }>;
}

const FALLBACK_AGENTS: Agent[] = ["codex", "gemini", "claude", "vscode", "antigravity"];
const API_BASE = import.meta.env.VITE_UAC_API_BASE ?? "http://127.0.0.1:4310";

/* ── Agent Icons (dashboardicons.com CDN + fallback) ── */
/* ── Local Agent Icons (Embedded SVGs) ── */

const IconOpenAI = () => (
  <svg className="agent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
  </svg>
);

const IconGemini = () => (
  <svg className="agent-icon" width="16" height="16" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z" fill="currentColor" />
  </svg>
);

const IconClaude = () => (
  <svg className="agent-icon" width="16" height="16" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#d97757" d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328857 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z" />
  </svg>
);

const IconVSCode = () => (
  <svg className="agent-icon" width="16" height="16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#0065A9" d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.17 4.17 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63" />
    <path fill="#007ACC" d="m96.461 89.204-20.604 9.92a6.23 6.23 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.17 4.17 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63" />
  </svg>
);

const IconAntigravity = () => (
  <svg className="agent-icon" width="16" height="16" viewBox="0 10 112 100" fill="#3186FF" xmlns="http://www.w3.org/2000/svg">
    <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" />
  </svg>
);

const IconCheck = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);

function AgentIcon({ agent }: { agent: string }) {
  const norm = agent.toLowerCase();
  if (norm.includes("openai") || norm.includes("codex")) return <IconOpenAI />;
  if (norm.includes("gemini")) return <IconGemini />;
  if (norm.includes("claude")) return <IconClaude />;
  if (norm.includes("vscode")) return <IconVSCode />;
  if (norm.includes("antigravity")) return <IconAntigravity />;

  return <IconPuzzle />;
}

/* ── Lucide-style SVG Icons ── */
const IconBolt = () => (
  <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
);
const IconPlug = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a6 6 0 0 1-12 0V8h12z" /></svg>
);
const IconPuzzle = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.407 2.407 0 0 1-1.705.707 2.408 2.408 0 0 1-1.704-.707l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.407 2.407 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.407 2.407 0 0 1 1.704-.706c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" /></svg>
);
const IconClipboard = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
);
const IconSearch = () => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
const IconSettings = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
);
const IconX = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
const IconRefresh = () => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
);
const IconEdit = () => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconDownload = () => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const IconChevronDown = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);
const IconPlus = () => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);
const IconSun = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2" /><path d="M12 21v2" /><path d="M4.22 4.22l1.42 1.42" /><path d="M18.36 18.36l1.42 1.42" /><path d="M1 12h2" /><path d="M21 12h2" /><path d="M4.22 19.78l1.42-1.42" /><path d="M18.36 5.64l1.42-1.42" /></svg>
);
const IconMoon = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
);
const IconMonitor = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
);
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `请求失败（${response.status}）`);
  }
  return payload;
}

let _agents: Agent[] = FALLBACK_AGENTS;
function emptyRow(value = false): MatrixRow {
  const row: Record<string, boolean> = {};
  for (const a of _agents) row[a] = value;
  return row as MatrixRow;
}

function diffLabel(diff: DiffInfo): string {
  return `+${diff.added.length} ~${diff.changed.length} -${diff.removed.length} =${diff.unchanged}`;
}

function toLines(input?: Record<string, string>, separator = "="): string {
  return Object.entries(input ?? {})
    .map(([k, v]) => `${k}${separator}${v}`)
    .join("\n");
}

function parseLines(text: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean)) {
    const match = line.match(/[:=]/);
    if (!match || match.index === undefined || match.index <= 0) {
      continue;
    }
    const idx = match.index;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseArgs(text: string): string[] | undefined {
  const args = text
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return args.length > 0 ? args : undefined;
}

function totalDiffCount(plan: PlanItem): number {
  return (
    plan.mcp.added.length +
    plan.mcp.changed.length +
    plan.mcp.removed.length +
    plan.skills.added.length +
    plan.skills.changed.length +
    plan.skills.removed.length
  );
}

export function App() {
  const [configPath, setConfigPath] = useState("");
  const [agents, setAgents] = useState<Agent[]>(FALLBACK_AGENTS);
  const [selectedAgent, setSelectedAgent] = useState<Agent>(FALLBACK_AGENTS[0]);
  const [subTab, setSubTab] = useState<"mcp" | "skills">("mcp");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string }>({ kind: "idle", text: "准备就绪" });




  const [mcpServers, setMcpServers] = useState<Record<string, UnifiedMcpServer>>({});
  const [skills, setSkills] = useState<Record<string, UnifiedSkill>>({});
  const [mcpMatrix, setMcpMatrix] = useState<MatrixMap>({});
  const [skillMatrix, setSkillMatrix] = useState<MatrixMap>({});
  const [dirtyMcp, setDirtyMcp] = useState(false);
  const [dirtySkills, setDirtySkills] = useState(false);
  const [mcpNotes, setMcpNotes] = useState<Record<string, string>>({});

  // Snapshot of loaded state for per-item dirty comparison
  const [initialMcpServers, setInitialMcpServers] = useState<Record<string, UnifiedMcpServer>>({});
  const [initialSkills, setInitialSkills] = useState<Record<string, UnifiedSkill>>({});
  const [initialMcpMatrix, setInitialMcpMatrix] = useState<MatrixMap>({});
  const [initialSkillMatrix, setInitialSkillMatrix] = useState<MatrixMap>({});

  const [mcpSearch, setMcpSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [selectedMcpId, setSelectedMcpId] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [editorMode, setEditorMode] = useState<"form" | "raw">("form");
  const [mcpRaw, setMcpRaw] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importSnippet, setImportSnippet] = useState("");
  const [importHint, setImportHint] = useState<ImportSourceHint>("auto");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewPick, setPreviewPick] = useState<Record<string, boolean>>({});

  // Drafts for Env/Headers editing to avoid parsing flickering
  const [envDraft, setEnvDraft] = useState("");
  const [headersDraft, setHeadersDraft] = useState("");
  const [argsDraft, setArgsDraft] = useState("");




  // Agent settings
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentInfo, setAgentInfo] = useState<Array<{ name: string; defaultPath: string; configuredPath: string | null; enabled: boolean; exists: boolean; defaultExists: boolean }>>([]);
  const [agentDraft, setAgentDraft] = useState<Array<{ name: string; defaultPath: string; configuredPath: string; enabled: boolean; exists: boolean; defaultExists: boolean }>>([]);

  // Theme
  const [theme, setTheme] = useState<"light" | "dark" | "auto">(() => {
    return (localStorage.getItem("uac_theme") as "light" | "dark" | "auto") || "auto";
  });

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem("uac_theme", theme);
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
  }, [theme]);

  // Per-item dirty comparison helpers (checks both server config and agent matrix)
  const isMcpDirty = (id: string): boolean => {
    const current = mcpServers[id];
    const initial = initialMcpServers[id];
    if (!initial) return true; // new item
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    // Also check matrix row
    if (JSON.stringify(mcpMatrix[id]) !== JSON.stringify(initialMcpMatrix[id])) return true;
    return false;
  };
  const isSkillDirty = (id: string): boolean => {
    const current = skills[id];
    const initial = initialSkills[id];
    if (!initial) return true;
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    if (JSON.stringify(skillMatrix[id]) !== JSON.stringify(initialSkillMatrix[id])) return true;
    return false;
  };

  function cycleTheme() {
    setTheme(curr => {
      if (curr === "auto") return "light";
      if (curr === "light") return "dark";
      return "auto";
    });
  }

  const ThemeIcon = theme === "auto" ? IconMonitor : theme === "light" ? IconSun : IconMoon;


  const enabledAgents = agents;
  const visibleAgents = useMemo(() => {
    if (agentInfo.length === 0) return agents;
    const enabledSet = new Set(agentInfo.filter(a => a.enabled).map(a => a.name));
    return agents.filter(a => enabledSet.has(a));
  }, [agents, agentInfo]);
  const filteredMcpIds = useMemo(
    () =>
      Object.keys(mcpServers)
        .sort()
        .filter((id) => id.toLowerCase().includes(mcpSearch.trim().toLowerCase())),
    [mcpServers, mcpSearch]
  );
  const filteredSkillIds = useMemo(
    () =>
      Object.keys(skills)
        .sort()
        .filter((id) => id.toLowerCase().includes(skillSearch.trim().toLowerCase())),
    [skills, skillSearch]
  );
  const currentMcp = selectedMcpId ? mcpServers[selectedMcpId] : undefined;
  const currentSkill = selectedSkillId ? skills[selectedSkillId] : undefined;
  const mcpCount = Object.keys(mcpServers).length;
  const skillCount = Object.keys(skills).length;


  const setError = (error: unknown) =>
    setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });

  // ── Data loading ──
  async function loadState(pathOverride?: string, silent = false) {
    const targetPath = pathOverride ?? configPath;
    if (!targetPath) {
      if (!silent) setError("配置路径为空");
      return;
    }

    if (!silent) setBusy(true);
    try {
      const payload = await fetchJson<{
        configPath: string;
        mcpServers: Record<string, UnifiedMcpServer>;
        skills: Record<string, UnifiedSkill>;
        mcpMatrix: MatrixMap;
        skillMatrix: MatrixMap;
      }>("/api/config/load", { method: "POST", body: JSON.stringify({ configPath: targetPath }) });

      setConfigPath(payload.configPath);
      setMcpServers(payload.mcpServers);
      setInitialMcpServers(JSON.parse(JSON.stringify(payload.mcpServers)));
      setSkills(payload.skills);
      setInitialSkills(JSON.parse(JSON.stringify(payload.skills)));
      setMcpMatrix(payload.mcpMatrix);
      setInitialMcpMatrix(JSON.parse(JSON.stringify(payload.mcpMatrix)));
      setSkillMatrix(payload.skillMatrix);
      setInitialSkillMatrix(JSON.parse(JSON.stringify(payload.skillMatrix)));
      setDirtyMcp(false);
      setDirtySkills(false);

      // Load notes
      try {
        const notesPayload = await fetchJson<{ notes: Record<string, string> }>("/api/notes");
        setMcpNotes(notesPayload.notes);
      } catch { /* ignore if notes endpoint not ready */ }

      // Load agent info
      try {
        const infoPayload = await fetchJson<{ agents: Array<{ name: string; defaultPath: string; configuredPath: string | null; enabled: boolean; exists: boolean; defaultExists: boolean }> }>("/api/agents/info", { method: "POST", body: JSON.stringify({ configPath: targetPath }) });
        setAgentInfo(infoPayload.agents);
      } catch { /* ignore */ }

      if (!silent) {
        setNotice({ kind: "success", text: `已刷新配置 (${new Date().toLocaleTimeString()})` });
        setTimeout(() => setNotice(curr => curr.text.includes("已刷新") ? { kind: "idle", text: "准备就绪" } : curr), 3000);
      }
    } catch (error) {
      setError(error);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      let attempts = 0;
      // Poll for backend availability (max 30s)
      while (mounted) {
        try {
          const defaults = await fetchJson<{ configPath: string; agents: Agent[] }>("/api/defaults");
          if (!mounted) return;

          setAgents(defaults.agents);
          _agents = defaults.agents;
          await loadState(defaults.configPath, true);
          setNotice({ kind: "idle", text: "准备就绪" }); // Clear connection errors
          break; // Connected and loaded
        } catch (error) {
          attempts++;
          if (!mounted) return;

          // Show connecting state if it takes a while
          if (attempts > 2) {
            setNotice({ kind: "idle", text: `正在连接后端... (${attempts}/30)` });
          }

          // Give up after 30 seconds
          if (attempts >= 30) {
            setError(new Error(`无法连接到后端服务 (超时)。请检查 server.exe 进程是否运行。\n详细错误: ${(error as Error).message}`));
            break;
          }
          // Wait 1s before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // selectedMcpId / selectedSkillId are now only set when opening edit modal
  // clear them if the underlying item was deleted
  useEffect(() => {
    if (selectedMcpId && !mcpServers[selectedMcpId]) setSelectedMcpId("");
  }, [mcpServers, selectedMcpId]);
  useEffect(() => {
    if (selectedSkillId && !skills[selectedSkillId]) setSelectedSkillId("");
  }, [skills, selectedSkillId]);

  useEffect(() => {
    if (selectedMcpId && mcpServers[selectedMcpId]) {
      setMcpRaw(JSON.stringify(mcpServers[selectedMcpId], null, 2));
    } else {
      setMcpRaw("");
    }
  }, [selectedMcpId, mcpServers, editorMode]);

  // Load drafts when filtering to a new MCP
  useEffect(() => {
    if (selectedMcpId && mcpServers[selectedMcpId]) {
      setEnvDraft(toLines(mcpServers[selectedMcpId].env, "="));
      setHeadersDraft(toLines(mcpServers[selectedMcpId].headers, ": "));
      setArgsDraft((mcpServers[selectedMcpId].args ?? []).join("\n"));
    } else {
      setEnvDraft("");
      setHeadersDraft("");
      setArgsDraft("");
    }
  }, [selectedMcpId]); // Intentionally exclude mcpServers to keep drafts during editing

  // ── Actions ──
  async function doValidate() {
    setBusy(true);
    try {
      const payload = await fetchJson<{ serverCount: number; skillCount: number }>("/api/validate", {
        method: "POST",
        body: JSON.stringify({ configPath })
      });
      setNotice({ kind: "success", text: `校验通过 — MCP: ${payload.serverCount}，Skills: ${payload.skillCount}` });
      await loadState(undefined, true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }





  async function saveMcp() {
    setBusy(true);
    try {
      await fetchJson("/api/mcp/save", {
        method: "POST",
        body: JSON.stringify({ configPath, servers: mcpServers, targetMatrix: mcpMatrix })
      });
      // Auto-sync to native agent config files
      const syncPayload = await fetchJson<{ snapshotId: string }>("/api/sync", {
        method: "POST",
        body: JSON.stringify({ configPath, agents: enabledAgents, dryRun: false })
      });
      setNotice({ kind: "success", text: `MCP 已保存并同步 — 快照: ${syncPayload.snapshotId}` });

      await loadState();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveSkills() {
    setBusy(true);
    try {
      await fetchJson("/api/skills/save", {
        method: "POST",
        body: JSON.stringify({ configPath, skills, targetMatrix: skillMatrix })
      });
      // Auto-sync to native agent config files
      const syncPayload = await fetchJson<{ snapshotId: string }>("/api/sync", {
        method: "POST",
        body: JSON.stringify({ configPath, agents: enabledAgents, dryRun: false })
      });
      setNotice({ kind: "success", text: `Skills 已保存并同步 — 快照: ${syncPayload.snapshotId}` });

      await loadState();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  // ── Matrix / CRUD ──
  function updateMcpMatrixCell(serverId: string, agent: Agent, value: boolean) {
    setMcpMatrix((current) => ({
      ...current,
      [serverId]: {
        ...(current[serverId] ?? emptyRow(false)),
        [agent]: value
      }
    }));
    setDirtyMcp(true);
  }

  function updateSkillMatrixCell(skillId: string, agent: Agent, value: boolean) {
    setSkillMatrix((current) => ({
      ...current,
      [skillId]: {
        ...(current[skillId] ?? emptyRow(false)),
        [agent]: value
      }
    }));
    setDirtySkills(true);
  }

  function updateCurrentMcp(patch: Partial<UnifiedMcpServer>) {
    if (!selectedMcpId || !mcpServers[selectedMcpId]) {
      return;
    }
    setMcpServers((current) => ({
      ...current,
      [selectedMcpId]: {
        ...current[selectedMcpId],
        ...patch
      }
    }));
    setDirtyMcp(true);
  }

  function updateCurrentSkill(patch: Partial<UnifiedSkill>) {
    if (!selectedSkillId || !skills[selectedSkillId]) {
      return;
    }
    setSkills((current) => ({
      ...current,
      [selectedSkillId]: {
        ...current[selectedSkillId],
        ...patch
      }
    }));
    setDirtySkills(true);
  }

  function switchMcp(nextId: string) {
    if (nextId === selectedMcpId) return;
    setSelectedMcpId(nextId);
  }

  // Copy-to state
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<Record<string, boolean>>({});
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const [copyPos, setCopyPos] = useState<{ top: number; left: number } | null>(null);

  // Close copy dropdown on scroll, resize, or outside click
  useEffect(() => {
    if (!copyOpen) return;
    const close = () => setCopyOpen(false);
    const onMouseDown = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.(".copy-dropdown");
      if (!el && !(e.target as HTMLElement).closest?.("[ref]")) close();
    };
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [copyOpen]);

  function copyToAgents() {
    const matrix = subTab === "mcp" ? mcpMatrix : skillMatrix;
    const items = subTab === "mcp" ? mcpServers : skills;
    const updateFn = subTab === "mcp" ? updateMcpMatrixCell : updateSkillMatrixCell;
    for (const agent of agents) {
      if (!copyTargets[agent]) continue;
      for (const itemId of Object.keys(items)) {
        updateFn(itemId, agent, matrix[itemId]?.[selectedAgent] ?? false);
      }
    }
    setCopyOpen(false);
    setNotice({ kind: "success", text: `已复制 ${subTab === "mcp" ? "MCP" : "Skills"} 配置到所选 Agent` });
  }

  function selectAllForAgent(value: boolean) {
    const items = subTab === "mcp" ? filteredMcpIds : filteredSkillIds;
    const updateFn = subTab === "mcp" ? updateMcpMatrixCell : updateSkillMatrixCell;
    for (const id of items) {
      updateFn(id, selectedAgent, value);
    }
  }

  function addMcp() {
    const id = window.prompt("请输入 MCP ID（例如 my-mcp）", "");
    if (!id) {
      return;
    }
    const serverId = id.trim();
    if (!serverId) {
      setNotice({ kind: "error", text: "MCP ID 不能为空" });
      return;
    }
    if (mcpServers[serverId]) {
      setNotice({ kind: "error", text: `MCP "${serverId}" 已存在` });
      return;
    }
    setMcpServers((current) => ({
      ...current,
      [serverId]: { transport: "stdio", command: "", args: [] }
    }));
    setMcpMatrix((current) => ({ ...current, [serverId]: emptyRow(true) }));
    setSelectedMcpId(serverId);
    setDirtyMcp(true);
  }

  function removeMcp() {
    if (!selectedMcpId) {
      return;
    }
    if (!window.confirm(`确定删除 MCP "${selectedMcpId}" 吗？`)) {
      return;
    }
    setMcpServers((current) => {
      const next = { ...current };
      delete next[selectedMcpId];
      return next;
    });
    setMcpMatrix((current) => {
      const next = { ...current };
      delete next[selectedMcpId];
      return next;
    });
    setSelectedMcpId("");
    setDirtyMcp(true);
  }

  function addSkill() {
    const id = window.prompt("请输入 Skill ID（例如 deploy-checklist）", "");
    if (!id) {
      return;
    }
    const skillId = id.trim();
    if (!skillId) {
      setNotice({ kind: "error", text: "Skill ID 不能为空" });
      return;
    }
    if (skills[skillId]) {
      setNotice({ kind: "error", text: `Skill "${skillId}" 已存在` });
      return;
    }
    setSkills((current) => ({
      ...current,
      [skillId]: { fileName: `${skillId}.md`, content: "" }
    }));
    setSkillMatrix((current) => ({ ...current, [skillId]: emptyRow(true) }));
    setSelectedSkillId(skillId);
    setDirtySkills(true);
  }

  function removeSkill() {
    if (!selectedSkillId) {
      return;
    }
    if (!window.confirm(`确定删除 Skill "${selectedSkillId}" 吗？`)) {
      return;
    }
    setSkills((current) => {
      const next = { ...current };
      delete next[selectedSkillId];
      return next;
    });
    setSkillMatrix((current) => {
      const next = { ...current };
      delete next[selectedSkillId];
      return next;
    });
    setSelectedSkillId("");
    setDirtySkills(true);
  }

  function applyRawMcp() {
    if (!selectedMcpId) {
      return;
    }
    try {
      const parsed = JSON.parse(mcpRaw) as UnifiedMcpServer;
      if (parsed.transport !== "stdio" && parsed.transport !== "sse") {
        throw new Error("transport 必须是 stdio 或 sse");
      }
      if (parsed.transport === "stdio" && (!parsed.command || !parsed.command.trim())) {
        throw new Error("stdio 模式必须包含 command");
      }
      if (parsed.transport === "sse" && (!parsed.url || !parsed.url.trim())) {
        throw new Error("sse 模式必须包含 url");
      }
      setMcpServers((current) => ({ ...current, [selectedMcpId]: parsed }));
      setDirtyMcp(true);
      setNotice({ kind: "success", text: `已应用 ${selectedMcpId} 原文编辑` });
    } catch (error) {
      setError(error);
    }
  }

  async function previewImport() {
    if (!importSnippet.trim()) {
      setNotice({ kind: "error", text: "请先粘贴 MCP 代码段" });
      return;
    }
    setBusy(true);
    try {
      const payload = await fetchJson<ImportPreviewResult>("/api/mcp/import/preview", {
        method: "POST",
        body: JSON.stringify({
          configPath,
          snippet: importSnippet,
          sourceHint: importHint
        })
      });
      setPreview(payload);
      setPreviewPick(Object.fromEntries(Object.keys(payload.servers).map((id) => [id, true])) as Record<string, boolean>);
      setNotice({ kind: "success", text: `预览完成 — ${Object.keys(payload.servers).length} 个 MCP` });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!preview) {
      return;
    }
    const selectedIds = Object.entries(previewPick)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);
    if (selectedIds.length === 0) {
      setNotice({ kind: "error", text: "请至少选择一个 MCP" });
      return;
    }
    setBusy(true);
    try {
      await fetchJson("/api/mcp/import/apply", {
        method: "POST",
        body: JSON.stringify({
          configPath,
          resolvedServers: preview.servers,
          selectedServerIds: selectedIds,
          mergePolicy: "overwrite"
        })
      });
      setNotice({ kind: "success", text: `导入完成 — ${selectedIds.length} 个 MCP` });
      setImportOpen(false);
      setImportSnippet("");
      setPreview(null);
      setPreviewPick({});
      await loadState();

    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  // ── Agent settings helpers ──
  async function openAgentSettings() {
    try {
      const payload = await fetchJson<{ agents: Array<{ name: string; defaultPath: string; configuredPath: string | null; enabled: boolean; exists: boolean; defaultExists: boolean }> }>("/api/agents/info", { method: "POST", body: JSON.stringify({ configPath }) });
      setAgentInfo(payload.agents);
      setAgentDraft(payload.agents.map(a => ({ ...a, configuredPath: a.configuredPath ?? "" })));
      setAgentSettingsOpen(true);
    } catch (error) {
      setError(error);
    }
  }

  async function autoDetect() {
    setBusy(true);
    try {
      const payload = await fetchJson<{ detected: string[] }>("/api/agents/detect", { method: "POST" });
      const detectedSet = new Set(payload.detected);

      setAgentDraft(prev => prev.map(a => {
        // If detected, we update the exists flag, and if it wasn't enabled, maybe we could enable it?
        // User asked for "Auto Detect" to set paths. 
        // Backend 'detect' currently just checks existence of default path.
        // We will update the 'exists' state in the draft so the UI reflects it immediately.
        const isDetected = detectedSet.has(a.name);
        return {
          ...a,
          exists: isDetected || a.exists, // Should we trust the new detection? Yes.
          defaultExists: isDetected,
          enabled: isDetected ? true : a.enabled // Auto-enable if detected? User said "click auto detect will find local installed agent". Implies enabling.
        };
      }));
      setNotice({ kind: "success", text: `已识别 ${payload.detected.length} 个本地 Agent` });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveAgentSettings() {
    try {
      setBusy(true);
      const settings: Record<string, { enabled: boolean; outputPath: string }> = {};
      for (const item of agentDraft) {
        settings[item.name] = { enabled: item.enabled, outputPath: item.configuredPath };
      }
      await fetchJson("/api/agents/settings", { method: "POST", body: JSON.stringify({ configPath, settings }) });
      setAgentInfo(agentDraft.map(a => ({ ...a, configuredPath: a.configuredPath || null })));
      setAgentSettingsOpen(false);
      setNotice({ kind: "success", text: "Agent 设置已保存" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  // ── Computed: items for current agent + subTab ──
  const currentItems = subTab === "mcp" ? filteredMcpIds : filteredSkillIds;
  const currentMatrix = subTab === "mcp" ? mcpMatrix : skillMatrix;
  const enabledCount = currentItems.filter((id) => currentMatrix[id]?.[selectedAgent]).length;
  const dirty = subTab === "mcp" ? dirtyMcp : dirtySkills;

  // ── MCP Edit Modal ──
  function renderMcpEditModal() {
    if (!selectedMcpId || !currentMcp) return null;
    return (
      <div className="drawer-mask" onClick={() => setSelectedMcpId("")}>
        <section className="panel mcp-edit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <h2>编辑 MCP</h2>
              <span className="module-editor-id">{selectedMcpId}</span>
            </div>
            <div className="tab-switch">
              <button
                type="button"
                className={editorMode === "form" ? "active" : ""}
                onClick={() => setEditorMode("form")}
              >
                表单视图
              </button>
              <button
                type="button"
                className={editorMode === "raw" ? "active" : ""}
                onClick={() => setEditorMode("raw")}
              >
                原文模式
              </button>
            </div>
          </div>

          <div className="modal-body">
            {editorMode === "form" ? (
              <div className="form-grid">
                <div className="form-row">
                  <label className="field">
                    <span>传输类型 (Transport)</span>
                    <select
                      value={currentMcp.transport}
                      onChange={(e) => {
                        const transport = e.target.value as "stdio" | "sse" | "http";
                        if (transport === "stdio") {
                          updateCurrentMcp({ transport, url: undefined, headers: undefined, command: currentMcp.command ?? "", args: currentMcp.args ?? [] });
                        } else {
                          updateCurrentMcp({ transport, command: undefined, args: undefined, env: undefined, startup_timeout_sec: undefined, url: currentMcp.url ?? "" });
                        }
                      }}
                    >
                      <option value="stdio">stdio (本地命令)</option>
                      <option value="sse">sse (Server-Sent Events)</option>
                      <option value="http">http (REST/Post)</option>
                    </select>
                  </label>
                  {currentMcp.transport === "stdio" && (
                    <label className="field">
                      <span>超时时间 (Seconds)</span>
                      <input
                        type="number"
                        placeholder="默认 10"
                        value={currentMcp.startup_timeout_sec ?? ""}
                        onChange={(e) => updateCurrentMcp({ startup_timeout_sec: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </label>
                  )}
                </div>

                {currentMcp.transport === "stdio" ? (
                  <>
                    <label className="field full-width">
                      <span>Command (Executable)</span>
                      <input
                        className="code-input"
                        value={currentMcp.command ?? ""}
                        onChange={(e) => updateCurrentMcp({ command: e.target.value })}
                        placeholder="e.g. npx, python, docker"
                      />
                    </label>
                    <label className="field full-width">
                      <span>Args (每行一个参数)</span>
                      <textarea
                        className="code-input"
                        value={argsDraft}
                        onChange={(e) => {
                          const val = e.target.value;
                          setArgsDraft(val);
                          updateCurrentMcp({ args: parseArgs(val) });
                        }}
                        placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/folder"
                        rows={5}
                      />
                    </label>
                    <label className="field full-width">
                      <span>Environment Variables (KEY=VALUE)</span>
                      <textarea
                        className="code-input"
                        value={envDraft}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEnvDraft(val);
                          updateCurrentMcp({ env: parseLines(val) });
                        }}
                        placeholder="API_KEY=xyz&#10;DEBUG=true"
                        rows={3}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field full-width">
                      <span>Server URL</span>
                      <input
                        className="code-input"
                        value={currentMcp.url ?? ""}
                        onChange={(e) => updateCurrentMcp({ url: e.target.value })}
                        placeholder="http://localhost:3000/sse"
                      />
                    </label>
                    <label className="field full-width">
                      <span>Headers (KEY=VALUE)</span>
                      <textarea
                        className="code-input"
                        value={headersDraft}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHeadersDraft(val);
                          updateCurrentMcp({ headers: parseLines(val) });
                        }}
                        placeholder="Authorization: Bearer token"
                        rows={3}
                      />
                    </label>
                  </>
                )}

                <div className="divider-horizontal" />

                <label className="field full-width">
                  <span>备注 (Notes)</span>
                  <textarea
                    value={mcpNotes[selectedMcpId] ?? ""}
                    onChange={(e) => {
                      const note = e.target.value;
                      setMcpNotes((prev) => ({ ...prev, [selectedMcpId]: note }));
                    }}
                    onBlur={() => {
                      const note = mcpNotes[selectedMcpId] ?? "";
                      void fetchJson("/api/notes", {
                        method: "POST",
                        body: JSON.stringify({ serverId: selectedMcpId, note })
                      }).catch(() => { });
                    }}
                    placeholder="添加备注信息，仅在本项目可见..."
                    rows={2}
                  />
                </label>
              </div>
            ) : (
              <div className="raw-editor">
                <textarea
                  className="code-input"
                  value={mcpRaw}
                  onChange={(e) => setMcpRaw(e.target.value)}
                  rows={7}
                />
                <button type="button" className="btn-secondary" disabled={busy} onClick={applyRawMcp}>应用更改</button>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-danger" disabled={busy} onClick={() => { if (confirm("确定删除此 MCP 配置吗？")) removeMcp(); }}>删除</button>
            <div style={{ flex: 1 }}></div>
            <button type="button" onClick={() => setSelectedMcpId("")}>关闭</button>
            <button type="button" className="btn-primary" disabled={busy || !dirtyMcp} onClick={saveMcp}>保存配置</button>
          </div>
        </section>
      </div>
    );
  }

  // ── Skill Edit Modal ──
  function renderSkillEditModal() {
    if (!selectedSkillId || !currentSkill) return null;
    return (
      <div className="drawer-mask" onClick={() => setSelectedSkillId("")}>
        <section className="panel mcp-edit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <h2>编辑 Skill</h2>
              <span className="module-editor-id">{selectedSkillId}</span>
            </div>
            {/* No tabs for skills yet, but keeping structure consistent */}
          </div>

          <div className="modal-body">
            <div className="form-grid">
              <label className="field full-width">
                <span>File Name</span>
                <input
                  value={currentSkill.fileName ?? ""}
                  onChange={(e) => updateCurrentSkill({ fileName: e.target.value })}
                  placeholder="e.g. my-skill.ts"
                />
              </label>
              <label className="field full-width">
                <span>Source Path (Optional)</span>
                <input
                  value={currentSkill.sourcePath ?? ""}
                  onChange={(e) => updateCurrentSkill({ sourcePath: e.target.value })}
                  placeholder="/absolute/path/to/source"
                />
              </label>
              <label className="field full-width">
                <span>Content</span>
                <textarea
                  className="code-input"
                  value={currentSkill.content ?? ""}
                  onChange={(e) => updateCurrentSkill({ content: e.target.value })}
                  placeholder="// TypeScript/JavaScript code..."
                  rows={12}
                />
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-danger" disabled={busy} onClick={() => { if (confirm("确定删除此 Skill 吗？")) removeSkill(); }}>删除</button>
            <div style={{ flex: 1 }}></div>
            <button type="button" onClick={() => setSelectedSkillId("")}>关闭</button>
            <button type="button" className="btn-primary" disabled={busy || !dirtySkills} onClick={saveSkills}>保存</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="uac-shell">
      {/* ── Top Bar ── */}
      <header className="panel topbar">
        <div className="topbar-brand">
          <h1><span className="brand-icon"><IconBolt /></span> AgentForge</h1>
        </div>
        <div className="topbar-config">
          <input
            value={configPath}
            onChange={(e) => setConfigPath(e.target.value)}
            placeholder="统一配置路径"
          />
        </div>
        <div className="topbar-actions">
          <div className={`notice-inline ${notice.kind}`} key={notice.text} title={notice.text}>
            {notice.text}
          </div>
          <button type="button" disabled={busy} onClick={() => void loadState()}><IconRefresh /></button>
          <button type="button" disabled={busy} onClick={doValidate}>校验</button>

          <div className="divider-vertical" style={{ width: 1, height: 16, background: "var(--border)", margin: "0 8px" }} />
          <button type="button" onClick={cycleTheme} title={`切换主题 (${theme})`}>
            <ThemeIcon />
          </button>
        </div>
      </header>

      {/* ── Agent Tab Bar ── */}
      <div className="tab-bar">
        {visibleAgents.map((agent) => (
          <button
            key={agent}
            type="button"
            className={`tab-button ${selectedAgent === agent ? "active" : ""}`}
            onClick={() => setSelectedAgent(agent)}
          >
            <span className="tab-icon"><AgentIcon agent={agent} /></span>
            {agent}
          </button>
        ))}
        <button type="button" className="agent-settings-btn" onClick={openAgentSettings} title="Agent 设置" style={{ marginLeft: "auto" }}>
          <IconSettings />
        </button>
      </div>

      {/* ── Main Workspace ── */}
      <main className="workspace">
        <section className="content">
          <section className="panel checklist-panel">
            {/* Sub-tab bar + action buttons */}
            <div className="checklist-head">
              <div className="sub-tab-bar">
                <button
                  type="button"
                  className={`sub-tab ${subTab === "mcp" ? "active" : ""}`}
                  onClick={() => setSubTab("mcp")}
                >
                  <IconPlug /> MCP
                  <span className="tab-count">{mcpCount}</span>
                  {dirtyMcp ? <span className="tab-dirty" /> : null}
                </button>
                <button
                  type="button"
                  className={`sub-tab ${subTab === "skills" ? "active" : ""}`}
                  onClick={() => setSubTab("skills")}
                >
                  <IconPuzzle /> Skills
                  <span className="tab-count">{skillCount}</span>
                  {dirtySkills ? <span className="tab-dirty" /> : null}
                </button>
              </div>
              <div className="action-row compact">
                {subTab === "mcp" ? (
                  <>
                    <button type="button" disabled={busy} onClick={addMcp}><IconPlus /> 新增</button>
                    <button type="button" disabled={busy} onClick={() => setImportOpen(true)}><IconDownload /> 导入</button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={addSkill}><IconPlus /> 新增</button>
                )}
              </div>
            </div>

            {/* Search bar */}
            <div className="search-box">
              <span className="search-icon"><IconSearch /></span>
              <input
                value={subTab === "mcp" ? mcpSearch : skillSearch}
                onChange={(e) => subTab === "mcp" ? setMcpSearch(e.target.value) : setSkillSearch(e.target.value)}
                placeholder={`搜索 ${subTab === "mcp" ? "MCP" : "Skill"}...`}
              />
            </div>

            {/* Toolbar: stats + bulk actions */}
            <div className="checklist-toolbar">
              <span className="checklist-stats">
                {enabledCount}/{currentItems.length} 已启用
              </span>
              <div className="action-row compact">
                <button type="button" onClick={() => selectAllForAgent(true)}>全选</button>
                <button type="button" onClick={() => selectAllForAgent(false)}>全不选</button>
                <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={subTab === "mcp" ? saveMcp : saveSkills}>保存</button>
                <button type="button" disabled={busy || !dirty} onClick={() => void loadState()}>放弃</button>
                <div className="divider-vertical" style={{ width: 1, height: 16, background: "var(--panel-border)", margin: "0 4px" }} />
                <button
                  type="button"
                  ref={copyBtnRef}
                  onClick={() => {
                    if (!copyOpen) {
                      const rect = copyBtnRef.current?.getBoundingClientRect();
                      if (rect) {
                        setCopyPos({
                          top: rect.bottom + 6,
                          left: Math.max(16, rect.right - 320)
                        });
                      }
                      setCopyTargets({});
                    }
                    setCopyOpen(!copyOpen);
                  }}
                  style={{ position: "relative" }}
                >
                  <IconClipboard className="icon-sm" style={{ marginRight: 6 }} /> 复制到…
                </button>
              </div>
            </div>

            {/* Copy dropdown (Portaled to body for z-index) */}
            {copyOpen && copyPos && createPortal(
              <div
                className="copy-dropdown"
                style={{
                  position: "fixed",
                  top: copyPos.top,
                  left: copyPos.left,
                  margin: 0,
                  zIndex: 9999
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="copy-dropdown-header">
                  <span className="copy-dropdown-label">选择目标 Agent：</span>
                  <button className="btn-icon-sm" onClick={() => setCopyOpen(false)}><IconX /></button>
                </div>

                <div className="copy-dropdown-agents">
                  {visibleAgents.filter((a) => a !== selectedAgent).map((agent) => (
                    <div
                      key={agent}
                      className="copy-agent-item"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCopyTargets((prev) => ({ ...prev, [agent]: !prev[agent] }));
                      }}
                    >
                      <div className={`checkbox-custom ${copyTargets[agent] ? "checked" : ""}`}>
                        {copyTargets[agent] && <IconCheck />}
                      </div>
                      <AgentIcon agent={agent} />
                      <span>{agent}</span>
                    </div>
                  ))}
                </div>
                <div className="divider-horizontal" />
                <button
                  type="button"
                  className="btn-primary full-width"
                  disabled={!Object.values(copyTargets).some(Boolean)}
                  onClick={copyToAgents}
                >
                  <IconClipboard className="icon-sm" style={{ marginRight: 6 }} />
                  确认复制 ({Object.values(copyTargets).filter(Boolean).length})
                </button>
              </div>,
              document.body
            )}

            {/* Checklist items */}
            <div className="checklist-items">
              {currentItems.map((id) => {
                const checked = currentMatrix[id]?.[selectedAgent] ?? false;
                const info = subTab === "mcp"
                  ? (mcpServers[id]?.transport ?? "-")
                  : (skills[id]?.fileName ?? "-");
                const isDirty = subTab === "mcp" ? isMcpDirty(id) : isSkillDirty(id);
                return (
                  <div key={id} className={`checklist-item ${checked ? "enabled" : "disabled"}`}>
                    <div className="col-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const fn = subTab === "mcp" ? updateMcpMatrixCell : updateSkillMatrixCell;
                          fn(id, selectedAgent, e.target.checked);
                        }}
                      />
                    </div>

                    <div className="col-name" title={id}>
                      <span className="checklist-item-name">{id}</span>
                      {isDirty && <span className="dirty-dot" title="有未保存改动" />}
                    </div>

                    <div className="col-info">
                      <span className="tag-info">{info}</span>
                    </div>

                    <div className="col-note">
                      {(() => {
                        const note = subTab === "mcp" ? mcpNotes[id] : skills[id]?.content?.slice(0, 50); // Show content preview for skills if no note
                        // Actually skills don't have 'notes' in the same way, but let's show whatever relevant.
                        // Ideally skills should have description. For now, empty or short content preview.
                        const displayNote = subTab === "mcp" ? (note || "") : "";
                        return <span className="note-text" title={displayNote}>{displayNote}</span>;
                      })()}
                    </div>

                    <div className="col-action">
                      <button
                        type="button"
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (subTab === "mcp") switchMcp(id);
                          else setSelectedSkillId(id);
                        }}
                        title="编辑配置"
                      >
                        <IconEdit />
                      </button>
                    </div>
                  </div>
                );
              })}
              {currentItems.length === 0 && (
                <p className="empty">暂无{subTab === "mcp" ? " MCP" : " Skill"}，点击「新增」添加。</p>
              )}
            </div>
          </section>
        </section>
      </main>



      {/* ── Advanced Drawer ── */}


      {/* ── Agent Settings Modal ── */}
      {agentSettingsOpen ? (
        <div className="drawer-mask" onClick={() => setAgentSettingsOpen(false)}>
          <section className="panel agent-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h2><IconSettings /> Agent 设置</h2>
              </div>
            </div>

            <div className="modal-body" style={{ padding: 0 }}>
              <div style={{ padding: "16px 24px", background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className="meta" style={{ margin: 0 }}>
                  <IconMonitor /> 配置 Agent 的启用状态。
                </p>
                <button type="button" onClick={() => void autoDetect()} disabled={busy}>
                  <IconRefresh /> 自动识别
                </button>
              </div>

              <table className="agent-settings-table">
                <thead>
                  <tr>
                    <th style={{ width: 60, textAlign: "center" }}>启用</th>
                    <th style={{ width: 140 }}>Agent</th>
                    <th>配置路径 (Configured Path)</th>
                    <th style={{ width: 100 }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {agentDraft.map((item, idx) => (
                    <tr key={item.name} className={item.enabled ? "enabled" : ""}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          className="toggle-checkbox"
                          checked={item.enabled}
                          onChange={(e) => setAgentDraft(prev => prev.map((a, i) => i === idx ? { ...a, enabled: e.target.checked } : a))}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <AgentIcon agent={item.name} />
                          <strong style={{ textTransform: "uppercase" }}>{item.name}</strong>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input
                            type="text"
                            className="agent-path-input"
                            value={item.configuredPath}
                            onChange={(e) => setAgentDraft(prev => prev.map((a, i) => i === idx ? { ...a, configuredPath: e.target.value } : a))}
                            placeholder={item.defaultPath}
                          />
                          {item.configuredPath && item.configuredPath !== item.defaultPath && (
                            <span className="meta" style={{ fontSize: "0.75rem" }}>默认: {item.defaultPath}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {item.exists ? (
                          <span className="tag" style={{ color: "var(--good)", background: "rgba(34, 197, 94, 0.1)" }}>已安装</span>
                        ) : (
                          <span className="tag" style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}>未找到</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setAgentSettingsOpen(false)}>取消</button>
              <div style={{ flex: 1 }}></div>
              <button type="button" className="btn-primary" disabled={busy} onClick={saveAgentSettings}>保存更改</button>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── MCP Edit Modal ── */}
      {renderMcpEditModal()}

      {/* ── Skill Edit Modal ── */}
      {renderSkillEditModal()}

      {/* ── Import Modal ── */}
      {/* ── Import Modal ── */}
      {importOpen ? (
        <div className="drawer-mask" onClick={() => setImportOpen(false)}>
          <section className="panel mcp-edit-modal" style={{ width: 800 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h2><IconDownload /> 导入配置</h2>
              </div>
              <div className="tab-switch">
                {/* Format Selector inside header for cleaner look, or keep in body? Body is better for flow. */}
              </div>
            </div>

            <div className="modal-body">
              {!preview ? (
                /* ── Input Stage ── */
                <div className="form-grid" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <p className="meta" style={{ fontSize: "0.9rem" }}>
                    支持从 mcp-router、Codex、Gemini/Claude 等多种格式导入 MCP 配置。
                  </p>

                  <div className="form-row">
                    <label className="field" style={{ flex: 1 }}>
                      <span>数据来源格式</span>
                      <select value={importHint} onChange={(e) => setImportHint(e.target.value as ImportSourceHint)}>
                        <option value="auto">自动识别 (Auto Detect)</option>
                        <option value="mcp_router_json">mcp-router JSON</option>
                        <option value="codex_toml">Codex TOML 片段</option>
                        <option value="gemini_json">Gemini/Claude JSON</option>
                        <option value="generic_mcp_json">通用 mcpServers JSON</option>
                      </select>
                    </label>
                  </div>

                  <label className="field full-width" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <span>配置代码段</span>
                    <textarea
                      className="code-input"
                      value={importSnippet}
                      onChange={(e) => setImportSnippet(e.target.value)}
                      placeholder={`粘贴 JSON 或 TOML 配置代码...\n\nExample:\n{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": [...] }\n  }\n}`}
                      style={{ flex: 1, minHeight: 300, resize: "none" }}
                    />
                  </label>
                </div>
              ) : (
                /* ── Preview Stage ── */
                <div className="import-preview">
                  <div className="notice-inline success" style={{ marginBottom: 16 }}>
                    已识别格式：<strong>{preview.detectedFormat}</strong>，共发现 <strong>{Object.keys(preview.servers).length}</strong> 个服务。
                  </div>

                  <div className="field full-width">
                    <span>选择要导入的服务</span>
                    <div className="import-item-list">
                      {Object.keys(preview.servers).sort().map((id) => (
                        <label key={id} className={`import-item-row ${previewPick[id] ? "picked" : ""}`}>
                          <input
                            type="checkbox"
                            checked={previewPick[id] ?? false}
                            onChange={(e) => setPreviewPick((c) => ({ ...c, [id]: e.target.checked }))}
                          />
                          <span className="mono" style={{ fontWeight: 600 }}>{id}</span>
                          {preview.conflicts.includes(id) && (
                            <span className="tag warn">覆盖现有</span>
                          )}
                          <span className="meta" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
                            {preview.servers[id].transport}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {preview.envSuggestions.length > 0 && (
                    <div className="preview-tips">
                      <h4><IconBolt /> 环境变量建议</h4>
                      <div className="tip-list">
                        {preview.envSuggestions.map((item) => (
                          <div key={`${item.serverId}:${item.fieldPath}`} className="tip-item">
                            <span className="mono">{item.serverId}</span>
                            <span className="arrow">→</span>
                            <span className="mono">{item.fieldPath}</span>
                            <span className="arrow">→</span>
                            <span className="highlight">{item.replacement}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.warnings.length > 0 && (
                    <div className="preview-tips warning">
                      <h4><IconBolt /> 解析警告</h4>
                      <div className="tip-list">
                        {preview.warnings.map((item, index) => (
                          <div key={`${item.code}-${index}`} className="tip-item">
                            <span className="tag">{item.code}</span>
                            <span>{item.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => {
                if (preview) { setPreview(null); } else { setImportOpen(false); }
              }}>
                {preview ? "返回修改" : "关闭"}
              </button>
              <div style={{ flex: 1 }}></div>
              {!preview ? (
                <button type="button" className="btn-primary" disabled={busy || !importSnippet.trim()} onClick={() => void previewImport()}>
                  生成预览
                </button>
              ) : (
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void applyImport()}>
                  确认导入 ({Object.values(previewPick).filter(Boolean).length})
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}


