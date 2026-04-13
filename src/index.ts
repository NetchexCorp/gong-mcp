import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { GongClient } from "./gong-client.js";
import type {
  CallBasicData,
  CallData,
  CallTranscript,
  Party,
  User,
  AnsweredScorecard,
  Scorecard,
} from "./gong-client.js";

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const MCP_API_KEY = process.env.MCP_API_KEY;
const GONG_BASE_URL = process.env.GONG_BASE_URL ?? "https://us-11858.api.gong.io";
const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_ACCESS_KEY_SECRET = process.env.GONG_ACCESS_KEY_SECRET;

if (!MCP_API_KEY) {
  console.error("Missing required env var: MCP_API_KEY");
  process.exit(1);
}

if (!GONG_ACCESS_KEY || !GONG_ACCESS_KEY_SECRET) {
  console.error(
    "Missing required env vars: GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET"
  );
  process.exit(1);
}

const gong = new GongClient(GONG_BASE_URL, GONG_ACCESS_KEY, GONG_ACCESS_KEY_SECRET);

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUser(u: User): string {
  const parts = [
    `ID: ${u.id}`,
    `Name: ${u.firstName} ${u.lastName}`,
    `Email: ${u.emailAddress}`,
    `Title: ${u.title || "N/A"}`,
    `Active: ${u.active}`,
    `Created: ${u.created}`,
  ];
  if (u.managerId) parts.push(`Manager ID: ${u.managerId}`);
  return parts.join("\n");
}

function formatCallBasic(c: CallBasicData): string {
  return [
    `ID: ${c.id}`,
    `Title: ${c.title}`,
    `Started: ${c.started}`,
    `Duration: ${Math.round(c.duration / 60)}m`,
    `Direction: ${c.direction}`,
    `Scope: ${c.scope}`,
    `System: ${c.system}`,
    `Primary User ID: ${c.primaryUserId}`,
    `URL: ${c.url}`,
  ].join("\n");
}

function formatParty(p: Party): string {
  const parts = [
    `  ${p.name} (${p.affiliation})`,
    `    Email: ${p.emailAddress ?? "N/A"}`,
    `    Title: ${p.title ?? "N/A"}`,
    `    Speaker ID: ${p.speakerId}`,
  ];
  if (p.userId) parts.push(`    Gong User ID: ${p.userId}`);
  if (p.context?.length) {
    for (const ctx of p.context) {
      for (const obj of ctx.objects) {
        const fields = obj.fields.map((f) => `${f.name}=${f.value}`).join(", ");
        parts.push(`    CRM (${ctx.system}): ${obj.objectType} ${obj.objectId} [${fields}]`);
      }
    }
  }
  return parts.join("\n");
}

function formatCallData(c: CallData): string {
  const sections: string[] = [];

  // Metadata
  sections.push("── Call Info ──");
  sections.push(formatCallBasic(c.metaData));

  // CRM context
  if (c.context?.length) {
    sections.push("\n── CRM Context ──");
    for (const ctx of c.context) {
      for (const obj of ctx.objects) {
        const fields = obj.fields.map((f) => `  ${f.name}: ${f.value}`).join("\n");
        sections.push(`${ctx.system} ${obj.objectType} (ID: ${obj.objectId})${obj.timing ? ` [${obj.timing}]` : ""}`);
        if (fields) sections.push(fields);
      }
    }
  }

  // Parties
  if (c.parties?.length) {
    sections.push("\n── Participants ──");
    for (const p of c.parties) {
      sections.push(formatParty(p));
    }
  }

  // Content
  if (c.content) {
    const content = c.content as Record<string, unknown>;
    if (content.brief) {
      sections.push("\n── Brief ──");
      sections.push(String(content.brief));
    }
    if (content.callOutcome) {
      sections.push("\n── Call Outcome ──");
      sections.push(String(content.callOutcome));
    }
    if (content.keyPoints) {
      sections.push("\n── Key Points ──");
      const kp = content.keyPoints as unknown[];
      sections.push(kp.map((p) => `• ${JSON.stringify(p)}`).join("\n"));
    }
    if (content.outline) {
      sections.push("\n── Outline ──");
      const outline = content.outline as unknown[];
      sections.push(outline.map((o) => JSON.stringify(o)).join("\n"));
    }
    if (content.highlights) {
      sections.push("\n── Highlights ──");
      const highlights = content.highlights as unknown[];
      sections.push(highlights.map((h) => JSON.stringify(h)).join("\n"));
    }
  }

  // Interaction stats
  if (c.interaction) {
    const ix = c.interaction as Record<string, unknown>;
    if (ix.personInteractionStats) {
      sections.push("\n── Interaction Stats ──");
      const stats = ix.personInteractionStats as unknown[];
      sections.push(JSON.stringify(stats, null, 2));
    }
  }

  return sections.join("\n");
}

function formatTranscript(t: CallTranscript): string {
  const lines: string[] = [`Call ID: ${t.callId}`, ""];
  for (const mono of t.transcript) {
    const topicTag = mono.topic ? ` [${mono.topic}]` : "";
    for (const s of mono.sentences) {
      const ts = formatTimestamp(s.start);
      lines.push(`[${ts}] Speaker ${mono.speakerId}${topicTag}: ${s.text}`);
    }
  }
  return lines.join("\n");
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatScorecard(sc: Scorecard): string {
  const lines = [
    `Scorecard: ${sc.scorecardName} (ID: ${sc.scorecardId})`,
    `Enabled: ${sc.enabled}`,
    `Created: ${sc.created}`,
    `Updated: ${sc.updated}`,
    `Questions:`,
  ];
  for (const q of sc.questions) {
    lines.push(`  [${q.questionId}] ${q.questionText}`);
    if (q.isOverall) lines.push(`    (Overall question)`);
    if (q.questionType) lines.push(`    Type: ${q.questionType}`);
    if (q.minRange != null && q.maxRange != null)
      lines.push(`    Range: ${q.minRange}-${q.maxRange}`);
    if (q.answerOptions?.length)
      lines.push(`    Options: ${q.answerOptions.map((o) => o.text).join(", ")}`);
  }
  return lines.join("\n");
}

function formatAnsweredScorecard(as: AnsweredScorecard): string {
  const lines = [
    `Scorecard: ${as.scorecardName} (ID: ${as.scorecardId})`,
    `Call ID: ${as.callId}`,
    `Call Start: ${as.callStartTime}`,
    `Reviewed User: ${as.reviewedUserId}`,
    `Reviewer: ${as.reviewerUserId}`,
    `Review Time: ${as.reviewTime}`,
    `Visibility: ${as.visibilityType}`,
    `Answers:`,
  ];
  for (const a of as.answers) {
    const parts = [`  Q${a.questionId}`];
    if (a.isOverall) parts.push("(Overall)");
    if (a.score != null) parts.push(`Score: ${a.score}`);
    if (a.answerText) parts.push(`"${a.answerText}"`);
    if (a.notApplicable) parts.push("N/A");
    if (a.selectedOptions?.length) parts.push(`Selected: ${a.selectedOptions.join(", ")}`);
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

// ── MCP Tool Registration ─────────────────────────────────────────────────

function registerTools(server: McpServer): void {

// ── Tool: list_users ──

server.tool(
  "list_users",
  "List all users in Gong. Returns names, emails, titles, and IDs. Supports pagination via cursor.",
  {
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  },
  async ({ cursor }) => {
    const result = await gong.listUsers(cursor);
    const text = [
      `Total users: ${result.records.totalRecords}`,
      `Page: ${result.records.currentPageNumber} (${result.records.currentPageSize} results)`,
      result.records.cursor ? `Next cursor: ${result.records.cursor}` : "",
      "",
      ...result.users.map((u) => formatUser(u) + "\n---"),
    ]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: get_user ──

server.tool(
  "get_user",
  "Get details for a specific Gong user by their ID.",
  {
    user_id: z.string().describe("Gong user ID (numeric string, up to 20 digits)"),
  },
  async ({ user_id }) => {
    const result = await gong.getUser(user_id);
    return { content: [{ type: "text", text: formatUser(result.user) }] };
  }
);

// ── Tool: list_calls ──

server.tool(
  "list_calls",
  "List Gong calls within a date range. Returns call metadata (title, duration, participants, direction).",
  {
    from_date: z
      .string()
      .describe("Start datetime in ISO-8601 format (e.g. 2024-01-01T00:00:00Z)"),
    to_date: z
      .string()
      .describe("End datetime in ISO-8601 format (e.g. 2024-01-31T23:59:59Z)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  },
  async ({ from_date, to_date, cursor }) => {
    const result = await gong.listCalls(from_date, to_date, cursor);
    const text = [
      `Total calls: ${result.records.totalRecords}`,
      `Page: ${result.records.currentPageNumber} (${result.records.currentPageSize} results)`,
      result.records.cursor ? `Next cursor: ${result.records.cursor}` : "",
      "",
      ...result.calls.map((c) => formatCallBasic(c) + "\n---"),
    ]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: get_call_details ──

server.tool(
  "get_call_details",
  "Get detailed call data including CRM context (Salesforce opportunities/accounts linked to the call), participants with their CRM records, call brief, outcome, key points, highlights, and interaction stats. This is the primary tool for connecting a Gong call to Salesforce data.",
  {
    call_ids: z
      .array(z.string())
      .min(1)
      .describe("One or more Gong call IDs to retrieve details for"),
    include_topics: z.boolean().optional().describe("Include topic breakdown (default: false)"),
    include_trackers: z.boolean().optional().describe("Include tracker matches (default: false)"),
  },
  async ({ call_ids, include_topics, include_trackers }) => {
    const result = await gong.getCallsExtensive(
      { callIds: call_ids },
      {
        includeContext: true,
        includeParties: true,
        includeBrief: true,
        includeOutline: true,
        includeHighlights: true,
        includeCallOutcome: true,
        includeKeyPoints: true,
        includeTopics: include_topics,
        includeTrackers: include_trackers,
      }
    );
    const text = result.calls.map((c) => formatCallData(c)).join("\n\n════════════════\n\n");
    return { content: [{ type: "text", text: text || "No calls found for the given IDs." }] };
  }
);

// ── Tool: get_call_transcript ──

server.tool(
  "get_call_transcript",
  "Get the full transcript of one or more Gong calls. Returns timestamped speaker-attributed text. Use speaker IDs cross-referenced with get_call_details parties to identify who said what.",
  {
    call_ids: z
      .array(z.string())
      .min(1)
      .describe("One or more Gong call IDs to get transcripts for"),
  },
  async ({ call_ids }) => {
    const result = await gong.getCallTranscripts({ callIds: call_ids });
    const text = result.callTranscripts
      .map((t) => formatTranscript(t))
      .join("\n\n════════════════\n\n");
    return { content: [{ type: "text", text: text || "No transcripts found for the given IDs." }] };
  }
);

// ── Tool: get_call_crm_associations ──

server.tool(
  "get_call_crm_associations",
  "Get manual CRM associations (Salesforce account/opportunity IDs) that users have linked to calls. Useful for finding which Salesforce opportunities or accounts are connected to specific calls.",
  {
    from_date: z
      .string()
      .optional()
      .describe("Only return associations created after this ISO-8601 datetime"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  },
  async ({ from_date, cursor }) => {
    const result = await gong.getManualCrmAssociations(from_date, cursor);
    const lines = [
      `Total associations: ${result.records.totalRecords}`,
      `Page: ${result.records.currentPageNumber} (${result.records.currentPageSize} results)`,
      result.records.cursor ? `Next cursor: ${result.records.cursor}` : "",
      "",
    ];
    for (const a of result.associations) {
      lines.push(`Call ID: ${a.callId}`);
      lines.push(`  Associated by User: ${a.userId}`);
      lines.push(`  Created: ${a.created}`);
      for (const obj of a.associatedCrmObjects) {
        if (obj.accountCrmId) lines.push(`  Account CRM ID: ${obj.accountCrmId}`);
        if (obj.dealCrmId) lines.push(`  Deal/Opportunity CRM ID: ${obj.dealCrmId}`);
      }
      lines.push("---");
    }
    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
  }
);

// ── Tool: list_scorecards ──

server.tool(
  "list_scorecards",
  "List all scorecard definitions configured in Gong, including their questions, scoring ranges, and answer options.",
  {},
  async () => {
    const result = await gong.listScorecards();
    const text = result.scorecards
      .map((sc) => formatScorecard(sc))
      .join("\n\n════════════════\n\n");
    return { content: [{ type: "text", text: text || "No scorecards found." }] };
  }
);

// ── Tool: get_call_scorecards ──

server.tool(
  "get_call_scorecards",
  "Get answered/completed scorecards for calls. Filter by call date range, review date range, specific scorecard IDs, or reviewed user IDs. Returns scores, answers, reviewer info, and links each result to a specific call ID.",
  {
    call_from_date: z
      .string()
      .optional()
      .describe("Filter by call date (inclusive), format: YYYY-MM-DD"),
    call_to_date: z
      .string()
      .optional()
      .describe("Filter by call date (exclusive), format: YYYY-MM-DD"),
    review_from_date: z
      .string()
      .optional()
      .describe("Filter by review date (inclusive), format: YYYY-MM-DD"),
    review_to_date: z
      .string()
      .optional()
      .describe("Filter by review date (exclusive), format: YYYY-MM-DD"),
    reviewed_user_ids: z
      .array(z.string())
      .optional()
      .describe("Filter to scorecards for specific reviewed users"),
    scorecard_ids: z
      .array(z.string())
      .optional()
      .describe("Filter to specific scorecard definition IDs"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  },
  async ({
    call_from_date,
    call_to_date,
    review_from_date,
    review_to_date,
    reviewed_user_ids,
    scorecard_ids,
    cursor,
  }) => {
    const result = await gong.getAnsweredScorecards(
      {
        callFromDate: call_from_date,
        callToDate: call_to_date,
        reviewFromDate: review_from_date,
        reviewToDate: review_to_date,
        reviewedUserIds: reviewed_user_ids,
        scorecardIds: scorecard_ids,
      },
      cursor
    );
    const lines = [
      `Total answered scorecards: ${result.records.totalRecords}`,
      `Page: ${result.records.currentPageNumber} (${result.records.currentPageSize} results)`,
      result.records.cursor ? `Next cursor: ${result.records.cursor}` : "",
      "",
    ];
    const formatted = result.answeredScorecards
      .map((as) => formatAnsweredScorecard(as))
      .join("\n\n---\n\n");
    return {
      content: [{ type: "text", text: lines.filter(Boolean).join("\n") + "\n" + formatted }],
    };
  }
);

} // end registerTools

// ── HTTP Server ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check (unauthenticated)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// API Key authentication middleware for MCP endpoints
function authenticateApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key || key !== MCP_API_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid or missing x-api-key header" });
    return;
  }
  next();
}

// Session management: map session IDs to transports
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Handle MCP requests (POST, GET for SSE, DELETE for session close)
app.all("/mcp", authenticateApiKey, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "GET" || req.method === "DELETE") {
    // GET (SSE listen) and DELETE (session close) require an existing session
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({ error: "No valid session. Send an initialize request first." });
      return;
    }
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // POST: either route to an existing session or create a new one on initialize
  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session: create transport + server instance
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
      console.log(`Session created: ${id} (active: ${sessions.size})`);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      console.log(`Session closed: ${id} (active: ${sessions.size})`);
    },
  });

  // Create a fresh MCP server bound to this session
  const sessionServer = createMcpServer();
  await sessionServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Factory that registers all Gong tools on a new McpServer instance
function createMcpServer(): McpServer {
  const s = new McpServer({ name: "gong-mcp", version: "1.0.0" });
  registerTools(s);
  return s;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gong MCP server listening on http://0.0.0.0:${PORT}/mcp`);
});
