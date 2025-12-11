import type { BuildSummary, AttributeMap } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function safeFetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<any> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }
  return response.json();
}

export interface PaginatedResponse {
  data: BuildSummary[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function fetchKnowledgeBase(limit = 10, page = 1): Promise<PaginatedResponse> {
  return safeFetch(`${API_BASE}/api/estimates/history?limit=${limit}&page=${page}`);
}

export async function fetchStats(): Promise<{ totalBuilds: number }> {
  return safeFetch(`${API_BASE}/api/estimates/stats`);
}

export async function uploadEstimate(file: File): Promise<BuildSummary> {
  const data = new FormData();
  data.append("buildFile", file);
  return safeFetch(`${API_BASE}/api/estimates/upload`, {
    method: "POST",
    body: data,
  });
}

export async function uploadMultipleEstimates(files: File[]): Promise<{ uploaded: number; builds: BuildSummary[] }> {
  const data = new FormData();
  files.forEach(file => data.append("buildFiles", file));
  return safeFetch(`${API_BASE}/api/estimates/upload-multiple`, {
    method: "POST",
    body: data,
  });
}

interface MatchPayload {
  file?: File;
  buildId?: string;
  limit?: number;
}

export interface CandidateMatch {
  id: string;
  fileName?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
  attributes: Record<string, string>;
  score?: number;
}

export interface AirweaveMatchResponse {
  referenceBuildId?: string;
  attributes: Record<string, string>;
  totalPrice?: string;
  matches: CandidateMatch[];
  completion?: string | null;
}

export async function requestMatches(payload: MatchPayload): Promise<AirweaveMatchResponse> {
  const data = new FormData();
  if (payload.file) {
    data.append("buildFile", payload.file);
  }
  if (payload.buildId) {
    data.append("buildId", payload.buildId);
  }
  data.append("limit", String(payload.limit ?? 4));
  return safeFetch(`${API_BASE}/api/estimates/match`, {
    method: "POST",
    body: data,
  });
}

export interface CreateFromTemplatePayload {
  originalName: string;
  attributes: AttributeMap;
  totalPrice?: string;
}

export async function createBuildFromTemplate(payload: CreateFromTemplatePayload): Promise<BuildSummary> {
  return safeFetch(`${API_BASE}/api/estimates/create-from-template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

