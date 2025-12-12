import type {
  BuildSummary,
  AttributeMap,
  ExtractedItem,
  BoqCompareResponse,
  EstimateDraft,
  EstimateDraftMeta,
  DraftEstimateState,
  EstimateStep,
} from "../types";

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
  files?: File[];
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
  if (payload.files && payload.files.length > 0) {
    payload.files.forEach((file) => data.append("buildFiles", file));
  } else if (payload.file) {
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

export interface ExtractedFile {
  fileName: string;
  attributes: AttributeMap;
  items: ExtractedItem[];
  totalPrice?: string;
}

export interface ExtractResponse {
  files: ExtractedFile[];
}

export async function extractEstimates(files: File[]): Promise<ExtractResponse> {
  const data = new FormData();
  files.forEach((file) => data.append("buildFiles", file));
  return safeFetch(`${API_BASE}/api/estimates/extract`, {
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

export async function compareBoq(extractedItems: ExtractedItem[], boqFile: File): Promise<BoqCompareResponse> {
  const data = new FormData();
  data.append("boqFile", boqFile);
  data.append("extractedItems", JSON.stringify(extractedItems ?? []));
  return safeFetch(`${API_BASE}/api/estimates/compare-boq`, {
    method: "POST",
    body: data,
  });
}

export async function extractBoq(boqFile: File): Promise<{ boqItems: ExtractedItem[]; rawContent?: string }> {
  const data = new FormData();
  data.append("boqFile", boqFile);
  return safeFetch(`${API_BASE}/api/estimates/boq/extract`, {
    method: "POST",
    body: data,
  });
}

export async function compareLists(drawingItems: ExtractedItem[], boqItems: ExtractedItem[]): Promise<BoqCompareResponse & { rawContent?: string }> {
  return safeFetch(`${API_BASE}/api/estimates/compare-lists`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ drawingItems, boqItems }),
  });
}

interface SaveDraftPayload {
  id?: string;
  name: string;
  step: EstimateStep;
  state: DraftEstimateState;
}

export async function saveDraft(payload: SaveDraftPayload): Promise<EstimateDraft> {
  return safeFetch(`${API_BASE}/api/drafts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function listDrafts(): Promise<EstimateDraftMeta[]> {
  return safeFetch(`${API_BASE}/api/drafts`);
}

export async function getDraft(id: string): Promise<EstimateDraft> {
  return safeFetch(`${API_BASE}/api/drafts/${id}`);
}

export async function removeDraft(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/drafts/${id}`, { method: "DELETE" });
}

