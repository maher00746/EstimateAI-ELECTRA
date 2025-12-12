export interface AttributeValue {
  value: string;
  price?: string;
}

export type EstimateStep = "upload" | "review" | "compare" | "finalize";

export interface ExtractedItem {
  item_number?: string;
  description?: string;
  capacity?: string;
  size?: string;
  quantity?: string;
  unit?: string;
  full_description?: string;
}

// Support both old format (string) and new format (object with value and price)
export type AttributeMap = Record<string, string | AttributeValue>;

export type ItemSource = "drawing" | "boq" | "manual";

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

export type ComparisonStatus =
  | "match_exact"
  | "match_quantity_diff"
  | "match_unit_diff"
  | "missing_in_boq"
  | "missing_in_drawing"
  | "no_match";

export interface BoqComparisonRow {
  drawing_item?: ExtractedItem | null;
  boq_item?: ExtractedItem | null;
  status: ComparisonStatus;
  note?: string;
}

export interface BoqCompareResponse {
  boqItems: ExtractedItem[];
  comparisons: BoqComparisonRow[];
  rawContent?: string;
}

export interface DraftFinalizeItem {
  item: ExtractedItem;
  source: ItemSource;
}

export interface DraftEstimateState {
  activeEstimateStep: EstimateStep;
  reviewStepActive: boolean;
  extractedFiles: Array<{ fileName: string; items: ExtractedItem[]; totalPrice?: string }>;
  boqResults: { boqItems: ExtractedItem[]; comparisons: BoqComparisonRow[] };
  comparisonSelections: Record<number, "drawing" | "boq" | "">;
  comparisonChecked: Record<number, boolean>;
  finalizeItems: DraftFinalizeItem[];
  pricingSelections: Array<{ source: "drawing" | "boq"; item: ExtractedItem }>;
  selectedBoqFileName?: string;
}

export interface EstimateDraftMeta {
  id: string;
  name: string;
  step: EstimateStep;
  updatedAt: string;
  createdAt: string;
}

export interface EstimateDraft extends EstimateDraftMeta {
  state: DraftEstimateState;
}

