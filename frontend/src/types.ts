export interface AttributeValue {
  value: string;
  price?: string;
}

// Support both old format (string) and new format (object with value and price)
export type AttributeMap = Record<string, string | AttributeValue>;

export interface BuildSummary {
  id: string;
  requestId: string;
  originalName: string;
  createdAt: string;
  attributes: AttributeMap;
  totalPrice?: string;
  link_to_file: string;
}

export interface CandidateMatch {
  id: string;
  fileName?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
  attributes: AttributeMap;
  score?: number;
}

