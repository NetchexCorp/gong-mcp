/**
 * Gong API v2 client with Basic Auth and automatic pagination.
 *
 * Base URL defaults to https://us-11858.api.gong.io/v2
 * Override via GONG_BASE_URL env var for different regions.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface Records {
  totalRecords: number;
  currentPageSize: number;
  currentPageNumber: number;
  cursor?: string;
}

export interface User {
  id: string;
  emailAddress: string;
  created: string;
  active: boolean;
  emailAliases: string[];
  firstName: string;
  lastName: string;
  title: string;
  phoneNumber?: string;
  extension?: string;
  managerId?: string;
  personalMeetingUrls?: string[];
}

export interface CallBasicData {
  id: string;
  url: string;
  title: string;
  scheduled?: string;
  started: string;
  duration: number;
  primaryUserId: string;
  direction: string;
  system: string;
  scope: string;
  media: string;
  language: string;
  workspaceId?: string;
  purpose?: string;
  meetingUrl?: string;
  isPrivate: boolean;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

export interface Monologue {
  speakerId: string;
  topic?: string;
  sentences: Sentence[];
}

export interface CallTranscript {
  callId: string;
  transcript: Monologue[];
}

export interface ContextField {
  name: string;
  value: string;
}

export interface ExternalObject {
  objectType: string;
  objectId: string;
  fields: ContextField[];
  timing?: string;
}

export interface CallContext {
  system: string;
  objects: ExternalObject[];
}

export interface PartyContext {
  system: string;
  objects: {
    objectType: string;
    objectId: string;
    fields: ContextField[];
    timing?: string;
  }[];
}

export interface Party {
  id: string;
  emailAddress?: string;
  name: string;
  title?: string;
  userId?: string;
  speakerId: string;
  context?: PartyContext[];
  affiliation: string;
  phoneNumber?: string;
}

export interface CallData {
  metaData: CallBasicData;
  context?: CallContext[];
  parties?: Party[];
  content?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  collaboration?: Record<string, unknown>;
}

export interface Scorecard {
  scorecardId: number;
  scorecardName: string;
  workspaceId?: number;
  enabled: boolean;
  updaterUserId?: number;
  created: string;
  updated: string;
  questions: {
    questionId: number;
    questionRevisionId: number;
    questionText: string;
    isOverall: boolean;
    questionType?: string;
    answerGuide?: string;
    minRange?: number;
    maxRange?: number;
    answerOptions?: { id: number; text: string }[];
  }[];
}

export interface Answer {
  questionId: number;
  questionRevisionId: number;
  isOverall: boolean;
  score?: number;
  answerText?: string;
  notApplicable: boolean;
  selectedOptions?: string[];
}

export interface AnsweredScorecard {
  answeredScorecardId: number;
  scorecardId: number;
  scorecardName: string;
  callId: number;
  callStartTime: string;
  reviewedUserId: number;
  reviewerUserId: number;
  reviewTime: string;
  visibilityType: string;
  answers: Answer[];
}

export interface ManualAssociation {
  callId: string;
  userId: string;
  created: string;
  associatedCrmObjects: {
    accountCrmId?: string;
    dealCrmId?: string;
  }[];
}

// ── Client ─────────────────────────────────────────────────────────────────

export class GongClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(baseUrl: string, accessKey: string, accessKeySecret: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader =
      "Basic " + Buffer.from(`${accessKey}:${accessKeySecret}`).toString("base64");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const resp = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gong API ${method} ${path} returned ${resp.status}: ${text}`);
    }

    return resp.json() as Promise<T>;
  }

  // ── Users ──

  async listUsers(cursor?: string): Promise<{ records: Records; users: User[] }> {
    const params: Record<string, string> = {};
    if (cursor) params.cursor = cursor;
    return this.request("GET", "/v2/users", undefined, params);
  }

  async getUser(id: string): Promise<{ user: User }> {
    return this.request("GET", `/v2/users/${encodeURIComponent(id)}`);
  }

  async listUsersExtensive(
    filter?: { userIds?: string[]; createdFromDateTime?: string; createdToDateTime?: string },
    cursor?: string
  ): Promise<{ records: Records; users: User[] }> {
    return this.request("POST", "/v2/users/extensive", {
      cursor,
      filter: filter ?? {},
    });
  }

  // ── Calls ──

  async listCalls(
    fromDateTime: string,
    toDateTime: string,
    cursor?: string
  ): Promise<{ records: Records; calls: CallBasicData[] }> {
    const params: Record<string, string> = { fromDateTime, toDateTime };
    if (cursor) params.cursor = cursor;
    return this.request("GET", "/v2/calls", undefined, params);
  }

  async getCall(id: string): Promise<{ call: CallBasicData }> {
    return this.request("GET", `/v2/calls/${encodeURIComponent(id)}`);
  }

  async getCallsExtensive(
    filter: {
      fromDateTime?: string;
      toDateTime?: string;
      callIds?: string[];
    },
    options?: {
      includeContext?: boolean;
      includeParties?: boolean;
      includeBrief?: boolean;
      includeOutline?: boolean;
      includeHighlights?: boolean;
      includeCallOutcome?: boolean;
      includeKeyPoints?: boolean;
      includeTrackers?: boolean;
      includeTopics?: boolean;
    },
    cursor?: string
  ): Promise<{ records: Records; calls: CallData[] }> {
    const opts = options ?? {};
    return this.request("POST", "/v2/calls/extensive", {
      cursor,
      filter,
      contentSelector: {
        context: opts.includeContext !== false ? "Extended" : "None",
        contextTiming: ["Now", "TimeOfCall"],
        exposedFields: {
          parties: opts.includeParties !== false,
          content: {
            structure: false,
            topics: opts.includeTopics ?? false,
            trackers: opts.includeTrackers ?? false,
            trackerOccurrences: false,
            pointsOfInterest: false,
            brief: opts.includeBrief ?? true,
            outline: opts.includeOutline ?? true,
            highlights: opts.includeHighlights ?? true,
            callOutcome: opts.includeCallOutcome ?? true,
            keyPoints: opts.includeKeyPoints ?? true,
          },
          interaction: {
            speakers: true,
            video: false,
            personInteractionStats: true,
            questions: true,
          },
          collaboration: {
            publicComments: true,
          },
        },
      },
    });
  }

  // ── Transcripts ──

  async getCallTranscripts(
    filter: {
      fromDateTime?: string;
      toDateTime?: string;
      callIds?: string[];
    },
    cursor?: string
  ): Promise<{ records: Records; callTranscripts: CallTranscript[] }> {
    return this.request("POST", "/v2/calls/transcript", {
      cursor,
      filter,
    });
  }

  // ── CRM Associations ──

  async getManualCrmAssociations(
    fromDateTime?: string,
    cursor?: string
  ): Promise<{ records: Records; associations: ManualAssociation[] }> {
    const params: Record<string, string> = {};
    if (fromDateTime) params.fromDateTime = fromDateTime;
    if (cursor) params.cursor = cursor;
    return this.request("GET", "/v2/calls/manual-crm-associations", undefined, params);
  }

  // ── Scorecards ──

  async listScorecards(): Promise<{ scorecards: Scorecard[] }> {
    return this.request("GET", "/v2/settings/scorecards");
  }

  async getAnsweredScorecards(
    filter: {
      callFromDate?: string;
      callToDate?: string;
      reviewFromDate?: string;
      reviewToDate?: string;
      reviewedUserIds?: string[];
      scorecardIds?: string[];
    },
    cursor?: string
  ): Promise<{ records: Records; answeredScorecards: AnsweredScorecard[] }> {
    return this.request("POST", "/v2/stats/activity/scorecards", {
      cursor,
      filter,
    });
  }
}
