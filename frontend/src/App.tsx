import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BuildSummary,
  AttributeMap,
  AttributeValue,
  ExtractedItem,
  BoqComparisonRow,
  EstimateStep,
  EstimateDraftMeta,
  DraftEstimateState,
  ItemSource,
} from "./types";
import type { PaginatedResponse } from "./services/api";
import {
  fetchKnowledgeBase,
  fetchStats,
  uploadMultipleEstimates,
  extractEstimates,
  createBuildFromTemplate,
  extractBoq,
  compareLists,
  listDrafts,
  saveDraft,
  getDraft,
} from "./services/api";
import { useAuth } from "./contexts/AuthContext";

const ITEMS_PER_PAGE = 10;

const ESTIMATE_STEPS: Array<{ id: EstimateStep; label: string; description: string }> = [
  { id: "upload", label: "Upload", description: "Drawings & BOQ" },
  { id: "review", label: "Review", description: "Validate extraction" },
  { id: "compare", label: "Compare", description: "BOQ vs drawings" },
  { id: "finalize", label: "Finalize", description: "Prep for pricing" },
];

const STEP_ORDER: Record<EstimateStep, number> = {
  upload: 0,
  review: 1,
  compare: 2,
  finalize: 3,
};

type AppPage = "knowledge" | "new-estimate" | "drafts";

// Helper function to get attribute value (handles both old and new format)
function getAttributeValue(attr: string | AttributeValue | undefined): string {
  if (!attr) return "—";
  if (typeof attr === 'string') return attr;
  return attr.value || "—";
}

function renderCell(value: string | undefined) {
  const text = value && value.trim() ? value : "—";
  return <span className="cell-text" title={text}>{text}</span>;
}

type ColumnResizeApi = {
  getStyle: (index: number) => React.CSSProperties | undefined;
  onMouseDown: (index: number, event: React.MouseEvent<HTMLSpanElement>) => void;
  resizingIndex: number | null;
};

function useColumnResize(): ColumnResizeApi {
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const indexRef = useRef<number | null>(null);

  const getStyle = useCallback(
    (index: number) => {
      const width = widths[index];
      return width ? { width, minWidth: width } : undefined;
    },
    [widths]
  );

  const onMouseDown = useCallback((index: number, event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const th = event.currentTarget.parentElement as HTMLElement | null;
    const startWidth = th?.getBoundingClientRect().width ?? 0;
    startXRef.current = event.clientX;
    startWidthRef.current = startWidth;
    indexRef.current = index;
    setResizingIndex(index);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (indexRef.current === null) return;
      const delta = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(80, startWidthRef.current + delta);
      setWidths(prev => ({ ...prev, [indexRef.current as number]: newWidth }));
    };

    const handleMouseUp = () => {
      indexRef.current = null;
      setResizingIndex(null);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseleave", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseleave", handleMouseUp);
  }, []);

  return { getStyle, onMouseDown, resizingIndex };
}

function ResizableTh({ resize, index, className, children }: { resize: ColumnResizeApi; index: number; className?: string; children: React.ReactNode }) {
  const style = resize.getStyle(index);
  const classes = ["resizable-th", className, resize.resizingIndex === index ? "is-resizing" : ""].filter(Boolean).join(" ");

  return (
    <th style={style} className={classes}>
      <div className="resizable-th__content">{children}</div>
      <span className="col-resizer" onMouseDown={(event) => resize.onMouseDown(index, event)} />
    </th>
  );
}

function UploadModal({ isOpen, onClose, onSuccess }: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uploadStage, setUploadStage] = useState(0);

  const uploadStages = [
    "Uploading the documents...",
    "Extracting the Attributes...",
    "Adding to the Knowledge Base..."
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setFeedback("Select at least one file");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }
    setUploading(true);
    setFeedback("");
    setUploadStage(0);

    // Animate through upload stages
    const stageInterval = setInterval(() => {
      setUploadStage(prev => {
        const next = prev + 1;
        return next < uploadStages.length ? next : prev;
      });
    }, 1500);

    try {
      const result = await uploadMultipleEstimates(files);
      clearInterval(stageInterval);
      setFeedback(`Successfully uploaded ${result.uploaded} file(s)`);
      setFiles([]);
      setTimeout(() => {
        onSuccess();
        onClose();
        setUploadStage(0);
      }, 1500);
    } catch (error) {
      clearInterval(stageInterval);
      setFeedback((error as Error).message);
      setTimeout(() => setFeedback(""), 5000);
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {uploading && (
        <div className="processing-overlay" style={{ zIndex: 3000 }}>
          <div className="processing-indicator">
            <div className="processing-indicator__spinner">
              <svg width="40" height="40" viewBox="0 0 40 40" className="spinner">
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="80" strokeDashoffset="20" strokeLinecap="round" />
              </svg>
            </div>
            <div className="processing-indicator__text">
              <p className="processing-indicator__message">{uploadStages[uploadStage]}</p>
              <div className="processing-indicator__progress">
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: `${((uploadStage + 1) / uploadStages.length) * 100}%` }} />
                </div>
                <span className="progress-text">Step {uploadStage + 1} of {uploadStages.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Upload Build Documents</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <form onSubmit={handleSubmit} className="modal-form">
            <label className="dropzone dropzone--modal">
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
              {files.length > 0
                ? `${files.length} file(s) selected: ${files.map(f => f.name).join(", ")}`
                : "Drag & drop or browse for build documents (multiple files supported)"}
            </label>
            {feedback && <p className="feedback">{feedback}</p>}
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={uploading}>
                Cancel
              </button>
              <button type="submit" disabled={uploading}>
                {uploading ? "Uploading..." : "Upload & Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function TemplateEditorModal({
  isOpen,
  onClose,
  onSuccess,
  initialAttributes
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialAttributes: AttributeMap;
}) {
  const [fileName, setFileName] = useState("");
  const [attributes, setAttributes] = useState<Record<string, AttributeValue>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const attributeResize = useColumnResize();

  useEffect(() => {
    if (isOpen) {
      // Convert initialAttributes to the new format
      const convertedAttrs: Record<string, AttributeValue> = {};
      const processedKeys = new Set<string>();

      Object.entries(initialAttributes).forEach(([key, val]) => {
        // Check if this is a flat key like "CPU.value" or "CPU.price"
        if (key.includes('.value') || key.includes('.price')) {
          const baseKey = key.replace('.value', '').replace('.price', '');

          if (!processedKeys.has(baseKey)) {
            processedKeys.add(baseKey);

            // Get both value and price for this attribute
            const valueKey = `${baseKey}.value`;
            const priceKey = `${baseKey}.price`;

            const valueData = initialAttributes[valueKey];
            const priceData = initialAttributes[priceKey];

            convertedAttrs[baseKey] = {
              value: typeof valueData === 'string' ? valueData : (valueData as any)?.value || '',
              price: typeof priceData === 'string' ? priceData : (priceData as any)?.price || undefined
            };
          }
        } else if (!processedKeys.has(key)) {
          // Regular attribute (not flat key format)
          processedKeys.add(key);

          if (typeof val === 'string') {
            // Old format: try to extract price from string
            const priceMatch = val.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
            convertedAttrs[key] = {
              value: val,
              price: priceMatch ? priceMatch[0] : undefined
            };
          } else {
            // New format: already has value and price
            convertedAttrs[key] = {
              value: val.value || '',
              price: val.price
            };
          }
        }
      });

      setAttributes(convertedAttrs);
      setFileName("");
      setFeedback("");
    }
  }, [isOpen, initialAttributes]);

  // Calculate total price from individual attribute prices
  const totalPrice = useMemo(() => {
    let total = 0;
    Object.values(attributes).forEach((attr) => {
      if (attr.price) {
        // Extract numeric value from price string (e.g., "$299.99" -> 299.99)
        const priceMatch = attr.price.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (!isNaN(price)) {
            total += price;
          }
        }
      }
    });
    return total.toFixed(2);
  }, [attributes]);

  const handleAttributeChange = (key: string, field: 'value' | 'price', newValue: string) => {
    setAttributes(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: newValue
      }
    }));
  };

  const handleSave = async () => {
    if (!fileName.trim()) {
      setFeedback("Please enter a file name");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }

    setSaving(true);
    setFeedback("");

    try {
      await createBuildFromTemplate({
        originalName: fileName.trim(),
        attributes,
        totalPrice: `$${totalPrice}`
      });

      setFeedback("Build saved successfully!");
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (error) {
      setFeedback((error as Error).message);
      setTimeout(() => setFeedback(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Build Template</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-form">
          <div className="form-group">
            <label htmlFor="fileName">File Name</label>
            <input
              id="fileName"
              type="text"
              className="form-input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Enter build name (e.g., Gaming PC Build 2025)"
              disabled={saving}
            />
          </div>

          <div className="attributes-editor">
            <h3>Attributes</h3>
            <div className="attributes-table-wrapper">
            <table className="attributes-table resizable-table">
                <thead>
                  <tr>
                  <ResizableTh resize={attributeResize} index={0}>Attribute</ResizableTh>
                  <ResizableTh resize={attributeResize} index={1}>Value</ResizableTh>
                  <ResizableTh resize={attributeResize} index={2}>Price</ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(attributes).map(([key, attr]) => (
                    <tr key={key}>
                      <td className="attribute-name-cell">{key}</td>
                      <td>
                        <input
                          type="text"
                          className="form-input form-input--table"
                          value={attr.value}
                          onChange={(e) => handleAttributeChange(key, 'value', e.target.value)}
                          disabled={saving}
                          placeholder="Component description"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-input form-input--table form-input--price"
                          value={attr.price || ''}
                          onChange={(e) => handleAttributeChange(key, 'price', e.target.value)}
                          disabled={saving}
                          placeholder="$0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="total-price">
            <strong>Total Price:</strong>
            <span className="price-value">${totalPrice}</span>
          </div>

          {feedback && <p className="feedback-inline">{feedback}</p>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtractedItemsTable({ file }: { file: { fileName: string; items: ExtractedItem[] } }) {
  const resize = useColumnResize();

  return (
    <div className="table-wrapper" style={{ marginTop: "1rem" }}>
      <div className="panel__header" style={{ marginBottom: "0.5rem" }}>
        <p className="eyebrow">File</p>
        <h4>{file.fileName}</h4>
      </div>
      <table className="matches-table resizable-table">
        <thead>
          <tr>
            <ResizableTh resize={resize} index={0}>Item #</ResizableTh>
            <ResizableTh resize={resize} index={1}>Description</ResizableTh>
            <ResizableTh resize={resize} index={2}>Capacity</ResizableTh>
            <ResizableTh resize={resize} index={3}>Size</ResizableTh>
            <ResizableTh resize={resize} index={4}>Quantity</ResizableTh>
            <ResizableTh resize={resize} index={5}>Unit</ResizableTh>
            <ResizableTh resize={resize} index={6}>Full description</ResizableTh>
          </tr>
        </thead>
        <tbody>
          {file.items?.length ? (
            file.items.map((item, idx) => (
              <tr key={`${file.fileName}-${item.item_number || idx}`} className="matches-table__row">
                <td>{renderCell(item.item_number)}</td>
                <td>{renderCell(item.description)}</td>
                <td>{renderCell(item.capacity)}</td>
                <td>{renderCell(item.size)}</td>
                <td>{renderCell(item.quantity)}</td>
                <td>{renderCell(item.unit)}</td>
                <td>{renderCell(item.full_description)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "rgba(227,233,255,0.7)" }}>
                No items returned for this file.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BoqItemsTable({ items }: { items: ExtractedItem[] }) {
  const resize = useColumnResize();

  return (
    <div className="table-wrapper table-wrapper--no-x" style={{ marginTop: "0.75rem" }}>
      <table className="matches-table resizable-table">
        <thead>
          <tr>
            <ResizableTh resize={resize} index={0} className="boq-col-description">Description</ResizableTh>
            <ResizableTh resize={resize} index={1}>Size</ResizableTh>
            <ResizableTh resize={resize} index={2}>Quantity</ResizableTh>
            <ResizableTh resize={resize} index={3} className="boq-col-unit">Unit</ResizableTh>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`boq-${item.item_number || idx}`} className="matches-table__row">
              <td className="boq-col-description">{renderCell(item.description || item.full_description)}</td>
              <td>{renderCell(item.size)}</td>
              <td>{renderCell(item.quantity)}</td>
              <td className="boq-col-unit">{renderCell(item.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditableItemsTable({
  items,
  onChange,
  title,
  onAddRow
}: {
  items: Array<{ item: ExtractedItem; source: ItemSource }>;
  onChange: (next: Array<{ item: ExtractedItem; source: ItemSource }>) => void;
  title: string;
  onAddRow: () => void;
}) {
  const handleChange = (idx: number, field: keyof ExtractedItem, value: string) => {
    const next = [...items];
    next[idx] = { ...next[idx], item: { ...next[idx].item, [field]: value } };
    onChange(next);
  };

  return (
    <div className="table-wrapper">
      <div className="panel__header" style={{ marginBottom: "0.5rem" }}>
        {title && <p className="eyebrow">{title}</p>}
      </div>
      <table className="matches-table resizable-table finalize-table">
        <thead>
          <tr>
            <th className="finalize-col finalize-col--description">Description</th>
            <th className="finalize-col finalize-col--size">Size</th>
            <th className="finalize-col finalize-col--qty">Quantity</th>
            <th className="finalize-col finalize-col--unit">Unit</th>
            <th className="finalize-col finalize-col--source">Source</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`finalize-${idx}`} className="matches-table__row">
              <td className="finalize-col finalize-col--description">
                <textarea
                  className="form-input form-input--table finalize-textarea"
                  value={item.item.description || item.item.full_description || ""}
                  onChange={(e) => handleChange(idx, "description", e.target.value)}
                  placeholder="Description"
                  rows={1}
                />
              </td>
              <td className="finalize-col finalize-col--size">
                <input
                  className="form-input form-input--table"
                  value={item.item.size || ""}
                  onChange={(e) => handleChange(idx, "size", e.target.value)}
                  placeholder="Size"
                />
              </td>
              <td className="finalize-col finalize-col--qty">
                <input
                  className="form-input form-input--table"
                  value={item.item.quantity || ""}
                  onChange={(e) => handleChange(idx, "quantity", e.target.value)}
                  placeholder="Qty"
                />
              </td>
              <td className="finalize-col finalize-col--unit">
                <input
                  className="form-input form-input--table"
                  value={item.item.unit || ""}
                  onChange={(e) => handleChange(idx, "unit", e.target.value)}
                  placeholder="Unit"
                />
              </td>
              <td className="finalize-col finalize-col--source">
                <input
                  className="form-input form-input--table"
                  value={item.source || "manual"}
                  readOnly
                  disabled
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn-secondary" onClick={onAddRow}>
          + Add row
        </button>
      </div>
    </div>
  );
}

function App() {
  const { user, logout } = useAuth();
  const [knowledgeBase, setKnowledgeBase] = useState<BuildSummary[]>([]);
  const [totalBuilds, setTotalBuilds] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    if (isUserMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUserMenuOpen]);
  const [matchingFiles, setMatchingFiles] = useState<File[]>([]);
  const [processingAI, setProcessingAI] = useState(false);
  const [matching, setMatching] = useState(false);
  const [extractedFiles, setExtractedFiles] = useState<Array<{ fileName: string; items: ExtractedItem[]; totalPrice?: string }>>([]);
  const [feedback, setFeedback] = useState<string>("");
  const [loadingStage, setLoadingStage] = useState(0);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);
  const [selectedTemplateAttributes, setSelectedTemplateAttributes] = useState<AttributeMap>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activePage, setActivePage] = useState<AppPage>("knowledge");
  const [activeEstimateStep, setActiveEstimateStep] = useState<EstimateStep>("upload");
  const [boqResults, setBoqResults] = useState<{ boqItems: ExtractedItem[]; comparisons: BoqComparisonRow[] }>({ boqItems: [], comparisons: [] });
  const [boqExtractLoading, setBoqExtractLoading] = useState(false);
  const [boqCompareLoading, setBoqCompareLoading] = useState(false);
  const [selectedBoqFileName, setSelectedBoqFileName] = useState<string>("");
  const [pendingBoqFile, setPendingBoqFile] = useState<File | null>(null);
  const [reviewStepActive, setReviewStepActive] = useState(false);
  const [finalizeItems, setFinalizeItems] = useState<Array<{ item: ExtractedItem; source: ItemSource }>>([]);
  const [comparisonSelections, setComparisonSelections] = useState<Record<number, "drawing" | "boq" | "">>({});
  const [comparisonChecked, setComparisonChecked] = useState<Record<number, boolean>>({});
  const [pricingSelections, setPricingSelections] = useState<Array<{ source: "drawing" | "boq"; item: ExtractedItem }>>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EstimateDraftMeta[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const hydratingDraftRef = useRef(false);
  const boqFileInputRef = useRef<HTMLInputElement | null>(null);
  const kbResize = useColumnResize();
  const comparisonResize = useColumnResize();
  const pricingResize = useColumnResize();
  const compareMessages = [
    "Reading BOQ…",
    "Extracting BOQ items…",
    "Comparing with drawing items…",
    "Finalizing comparison…"
  ];
  const [compareStage, setCompareStage] = useState(0);

  const hasDraftContent = useMemo(() => {
    return (
      extractedFiles.length > 0 ||
      boqResults.boqItems.length > 0 ||
      boqResults.comparisons.length > 0 ||
      finalizeItems.length > 0 ||
      pricingSelections.length > 0 ||
      Object.keys(comparisonSelections).length > 0 ||
      Object.keys(comparisonChecked).length > 0 ||
      Boolean(selectedBoqFileName)
    );
  }, [
    extractedFiles,
    boqResults,
    finalizeItems,
    pricingSelections,
    comparisonSelections,
    comparisonChecked,
    selectedBoqFileName,
  ]);

  const captureDraftState = useCallback((): DraftEstimateState => {
    return {
      activeEstimateStep,
      reviewStepActive,
      extractedFiles,
      boqResults,
      comparisonSelections,
      comparisonChecked,
      finalizeItems,
      pricingSelections,
      selectedBoqFileName,
    };
  }, [
    activeEstimateStep,
    reviewStepActive,
    extractedFiles,
    boqResults,
    comparisonSelections,
    comparisonChecked,
    finalizeItems,
    pricingSelections,
    selectedBoqFileName,
  ]);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (activeEstimateStep === "upload" || !hasDraftContent) {
      return false;
    }
    const resolvedName =
      draftName.trim() || `Draft ${new Date().toLocaleString()}`;

    if (!draftName.trim()) {
      setDraftName(resolvedName);
    }

    setDraftStatus("saving");
    try {
      const saved = await saveDraft({
        id: draftId ?? undefined,
        name: resolvedName,
        step: activeEstimateStep,
        state: captureDraftState(),
      });
      setDraftId(saved.id);
      setLastDraftSavedAt(saved.updatedAt);
      setDraftStatus("saved");
      return true;
    } catch (error) {
      console.error("Failed to save draft", error);
      setDraftStatus("error");
      setFeedback("Unable to auto-save draft. Please try again.");
      setTimeout(() => setFeedback(""), 3500);
      return false;
    }
  }, [
    activeEstimateStep,
    captureDraftState,
    draftId,
    draftName,
    hasDraftContent,
  ]);

  const refreshDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const rows = await listDrafts();
      setDrafts(rows);
      setSelectedDraftId((prev) => {
        if (prev && rows.some((d) => d.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (error) {
      console.error("Failed to load drafts", error);
      setFeedback("Unable to load drafts.");
      setTimeout(() => setFeedback(""), 3500);
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeEstimateStep === "upload" || draftName) return;
    setDraftName(`Draft ${new Date().toLocaleString()}`);
  }, [activeEstimateStep, draftName]);

  useEffect(() => {
    if (activePage !== "new-estimate") return;
    if (activeEstimateStep === "upload") return;
    if (!hasDraftContent) return;
    const handle = setTimeout(() => {
      void persistDraft();
    }, 1200);
    return () => clearTimeout(handle);
  }, [activePage, activeEstimateStep, hasDraftContent, persistDraft]);

  useEffect(() => {
    if (activePage !== "drafts") return;
    void refreshDrafts();
  }, [activePage, refreshDrafts]);

  const maxAttributesInFile = useMemo(() => {
    if (knowledgeBase.length === 0) return 0;
    return Math.max(...knowledgeBase.map(build => Object.keys(build.attributes).length));
  }, [knowledgeBase]);

  useEffect(() => {
    refreshHistory();
    loadStats();
  }, [currentPage]);

  useEffect(() => {
    // When comparisons update from a new run, clear selections.
    // Skip clearing when we are hydrating a draft.
    if (hydratingDraftRef.current) return;
    setComparisonSelections({});
    setPricingSelections([]);
  }, [boqResults.comparisons]);

  const loadStats = async () => {
    try {
      const stats = await fetchStats();
      setTotalBuilds(stats.totalBuilds);
    } catch (error) {
      console.error("Failed to load stats", error);
    }
  };

  const refreshHistory = async () => {
    setLoadingHistory(true);
    try {
      const response: PaginatedResponse = await fetchKnowledgeBase(ITEMS_PER_PAGE, currentPage);
      setKnowledgeBase(response.data);
      setTotalBuilds(response.totalCount);
      setTotalPages(response.totalPages);
    } catch (error) {
      setFeedback("Unable to load knowledge base.");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadingMessages = [
    "Uploading files…",
    "Reading documents…",
    "Extracting specifications with AI…",
    "Structuring results…",
    "Preparing preview…"
  ];

  const resetEstimateFlow = useCallback(() => {
    hydratingDraftRef.current = false;
    setActiveEstimateStep("upload");
    setReviewStepActive(false);
    setMatchingFiles([]);
    setProcessingAI(false);
    setMatching(false);
    setExtractedFiles([]);
    setBoqResults({ boqItems: [], comparisons: [] });
    setBoqExtractLoading(false);
    setBoqCompareLoading(false);
    setCompareStage(0);
    setSelectedBoqFileName("");
    setPendingBoqFile(null);
    setFinalizeItems([]);
    setComparisonSelections({});
    setComparisonChecked({});
    setPricingSelections([]);
    setFeedback("");
    setDraftId(null);
    setDraftName("");
    setDraftStatus("idle");
    setLastDraftSavedAt(null);
  }, []);

  const handleStartNewEstimate = () => {
    resetEstimateFlow();
    setActivePage("new-estimate");
  };

  const handleContinueDraft = async () => {
    if (!selectedDraftId) return;
    setLoadingDraft(true);
    hydratingDraftRef.current = true;
    try {
      const draft = await getDraft(selectedDraftId);
      const state = (draft.state as DraftEstimateState) || {};
      const toNumberRecord = <T,>(input?: Record<string, T> | Record<number, T>): Record<number, T> => {
        const output: Record<number, T> = {};
        Object.entries(input ?? {}).forEach(([key, value]) => {
          const numKey = Number(key);
          if (!Number.isNaN(numKey)) {
            output[numKey] = value as T;
          }
        });
        return output;
      };

      setActivePage("new-estimate");
      setActiveEstimateStep(state.activeEstimateStep || "review");
      setReviewStepActive(state.reviewStepActive ?? true);
      setExtractedFiles(state.extractedFiles || []);
      setBoqResults(
        state.boqResults || { boqItems: [], comparisons: [] }
      );
      setComparisonSelections(toNumberRecord(state.comparisonSelections));
      setComparisonChecked(toNumberRecord(state.comparisonChecked));
      setFinalizeItems(state.finalizeItems || []);
      setPricingSelections(state.pricingSelections || []);
      setSelectedBoqFileName(state.selectedBoqFileName || "");
      setPendingBoqFile(null);
      setMatchingFiles([]);
      setDraftId(draft.id);
      setDraftName(draft.name);
      setLastDraftSavedAt(draft.updatedAt);
      setFeedback("Draft loaded. Continue your estimate.");
      setTimeout(() => setFeedback(""), 3000);
    } catch (error) {
      setFeedback((error as Error).message || "Failed to load draft.");
      setTimeout(() => setFeedback(""), 3500);
    } finally {
      setLoadingDraft(false);
      // Allow the next comparisons change (e.g., a new compare run) to clear selections
      // but keep hydration protection through the next paint.
      setTimeout(() => {
        hydratingDraftRef.current = false;
      }, 350);
    }
  };

  const handleExtract = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!matchingFiles.length && !pendingBoqFile) {
      setFeedback("Upload drawings or BOQ to start a review.");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }
    const hasDrawings = matchingFiles.length > 0;
    const hasBoq = !!pendingBoqFile;
    setMatching(hasDrawings);
    setProcessingAI(hasDrawings);
    setReviewStepActive(false);
    setActiveEstimateStep("upload");
    setFeedback("");
    if (hasDrawings) {
      setExtractedFiles([]);
      setLoadingStage(0);
    }

    let stageInterval: ReturnType<typeof setInterval> | null = null;
    if (hasDrawings) {
      stageInterval = setInterval(() => {
        setLoadingStage(prev => {
          const next = prev + 1;
          return next < loadingMessages.length ? next : prev;
        });
      }, 1500);
    }

    try {
      let drawingsSucceeded = false;
      if (hasDrawings) {
        const payload = await extractEstimates(matchingFiles);
        if (stageInterval) clearInterval(stageInterval);
        setExtractedFiles(payload.files ?? []);
        setMatchingFiles([]);
        drawingsSucceeded = !!(payload.files && payload.files.length > 0);
        const message = drawingsSucceeded ? "Drawings extracted." : "No drawing items returned.";
        setFeedback(message);
        setTimeout(() => setFeedback(""), 3000);
      }

      let boqSucceeded = false;
      if (hasBoq && pendingBoqFile) {
        setBoqExtractLoading(true);
        try {
          const extractResp = await extractBoq(pendingBoqFile);
          setBoqResults({ boqItems: extractResp.boqItems || [], comparisons: [] });
          boqSucceeded = !!(extractResp.boqItems && extractResp.boqItems.length > 0);
          const msg = boqSucceeded ? "BOQ extracted." : "No BOQ items were parsed from this file.";
          setFeedback(msg);
          setTimeout(() => setFeedback(""), 3000);
        } catch (error) {
          setFeedback((error as Error).message);
          setTimeout(() => setFeedback(""), 5000);
        } finally {
          setBoqExtractLoading(false);
          setPendingBoqFile(null);
        }
      }

      if (drawingsSucceeded || boqSucceeded) {
        setReviewStepActive(true);
        setActiveEstimateStep("review");
      }
    } catch (error) {
      if (stageInterval) clearInterval(stageInterval);
      const errorMessage = (error as Error).message;
      setFeedback(errorMessage);
      setTimeout(() => setFeedback(""), 5000);
      if (hasDrawings) {
        setExtractedFiles([]);
      }
    } finally {
      if (stageInterval) clearInterval(stageInterval);
      setMatching(false);
      setProcessingAI(false);
      setLoadingStage(0);
    }
  };

  const handleRowClick = (linkToFile: string) => {
    window.open(linkToFile, "_blank");
  };

  const handleUseAsTemplate = (attributes: AttributeMap) => {
    setSelectedTemplateAttributes(attributes);
    setIsTemplateEditorOpen(true);
  };

  const handleComparisonSelect = (rowIndex: number, source: "drawing" | "boq") => {
    setComparisonSelections(prev => ({ ...prev, [rowIndex]: source }));
    setComparisonChecked(prev => ({ ...prev, [rowIndex]: true }));
  };

  const handleComparisonCheck = (rowIndex: number, checked: boolean) => {
    setComparisonChecked(prev => ({ ...prev, [rowIndex]: checked }));
  };

  const handleComparisonCellSelect = (rowIndex: number, source: "drawing" | "boq", hasItem: boolean) => {
    if (!hasItem) return;
    handleComparisonSelect(rowIndex, source);
  };

  const handleProceedToPricing = () => {
    const selected = Object.values(comparisonSelections);
    if (!selected.length) {
      setFeedback("Select at least one item before proceeding to pricing.");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }
    setPricingSelections(selected);
  };

  const processingMessage = processingAI
    ? matching
      ? loadingMessages[loadingStage] || loadingMessages[0]
      : "Processing documents with AI..."
    : "";

  const heroTitle =
    activePage === "drafts"
      ? "My Drafts"
      : activePage === "new-estimate" && activeEstimateStep === "review"
        ? "Review Extracted Items"
        : activePage === "new-estimate" && activeEstimateStep === "compare"
          ? "Select the Items to include in the Estimate"
          : activePage === "new-estimate" && activeEstimateStep === "finalize"
            ? "Finalize the items before moving to Pricing"
            : "Upload Drawings and BOQ to start the Estimation";

  const handleBoqFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPendingBoqFile(file);
    setSelectedBoqFileName(file.name);
    setFeedback("BOQ file ready for extraction.");
    setTimeout(() => setFeedback(""), 2500);
  };

  const getComparisonClass = (status: string) => {
    if (status === "match_exact") return "compare-row--ok";
    if (status === "match_quantity_diff" || status === "match_unit_diff") return "compare-row--warn";
    if (status === "missing_in_boq" || status === "missing_in_drawing") return "compare-row--missing";
    return "";
  };

  const drawingItemsFlat = useMemo(
    () => extractedFiles.flatMap((f) => f.items || []),
    [extractedFiles]
  );

  const hasDrawingData = drawingItemsFlat.length > 0;
  const hasBoqData = boqResults.boqItems.length > 0;
  const hasAnyComparisonChecked = useMemo(
    () => boqResults.comparisons.some((_, idx) => comparisonChecked[idx]),
    [boqResults.comparisons, comparisonChecked]
  );
  const hasMissingComparisonSelection = useMemo(() => {
    let missing = false;
    boqResults.comparisons.forEach((row, idx) => {
      if (!comparisonChecked[idx]) return;
      if (row.status === "match_exact") return;
      const chosen = comparisonSelections[idx];
      if (!chosen) missing = true;
    });
    return missing;
  }, [boqResults.comparisons, comparisonChecked, comparisonSelections]);

  const getStepStatus = (stepId: EstimateStep): "complete" | "current" | "upcoming" => {
    const order = STEP_ORDER[stepId];
    if (order < STEP_ORDER[activeEstimateStep]) return "complete";
    if (order === STEP_ORDER[activeEstimateStep]) return "current";
    return "upcoming";
  };

  const canNavigateToStep = (stepId: EstimateStep) => {
    switch (stepId) {
      case "upload":
        return true;
      case "review":
        return reviewStepActive || hasDrawingData || hasBoqData;
      case "compare":
        return boqResults.comparisons.length > 0;
      case "finalize":
        return finalizeItems.length > 0 || activeEstimateStep === "finalize";
      default:
        return false;
    }
  };

  const handleStepChange = (stepId: EstimateStep) => {
    if (stepId === activeEstimateStep) return;
    if (!canNavigateToStep(stepId)) {
      setFeedback("This step is not ready yet.");
      setTimeout(() => setFeedback(""), 2500);
      return;
    }
    setActiveEstimateStep(stepId);
  };

  const handleProceedFromReview = async () => {
    if (hasDrawingData && hasBoqData) {
      await handleRunCompare();
      return;
    }
    const sourceItems = hasDrawingData ? drawingItemsFlat : boqResults.boqItems;
    setFinalizeItems(sourceItems.map(item => ({ item, source: hasDrawingData ? "drawing" : "boq" })));
    setActiveEstimateStep("finalize");
  };

  const handleRunCompare = async () => {
    if (!hasDrawingData || !hasBoqData) return;
    setBoqCompareLoading(true);
    setCompareStage(0);
    const stageInterval = setInterval(() => {
      setCompareStage((prev) => {
        if (prev >= compareMessages.length - 1) {
          clearInterval(stageInterval);
          return prev;
        }
        return prev + 1;
      });
    }, 2500);
    try {
      const allItems = drawingItemsFlat;
      const compareResp = await compareLists(allItems, boqResults.boqItems);
      const raw = compareResp.rawContent;
      let comparisons = compareResp.comparisons || [];
      if ((!comparisons || comparisons.length === 0) && raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            comparisons = parsed as any;
          } else if (parsed.comparisons || parsed.matches || parsed.result) {
            comparisons = parsed.comparisons || parsed.matches || parsed.result || [];
          }
        } catch (e) {
          console.warn("Failed to parse raw comparison content", e);
        }
      }
      setBoqResults((prev) => ({
        ...prev,
        comparisons: comparisons || [],
      }));
      setFeedback("Comparison completed.");
      setTimeout(() => setFeedback(""), 3000);
      setActiveEstimateStep("compare");
    } catch (error) {
      setFeedback((error as Error).message);
      setTimeout(() => setFeedback(""), 5000);
    } finally {
      setBoqCompareLoading(false);
      clearInterval(stageInterval);
      setCompareStage(0);
    }
  };

  return (
    <div className={`app-shell ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__icon">
            <img
              src="/logo2.png"
              alt="Logo"
              style={{ width: "34px", height: "34px", objectFit: "contain" }}
            />
          </div>
          <div>
            <p className="brand__title">AI Powered Estimation System</p>
          </div>
        </div>

        <nav className="sidebar__nav">
          <button
            type="button"
            className={`nav-link ${activePage === "knowledge" ? "is-active" : ""}`}
            onClick={() => setActivePage("knowledge")}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 4h14M3 10h14M3 16h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Knowledge Base</span>
          </button>
          <button
            type="button"
            className={`nav-link ${activePage === "new-estimate" ? "is-active" : ""}`}
            onClick={handleStartNewEstimate}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M10 6v8M6 10h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>New Estimate</span>
          </button>
          <button
            type="button"
            className={`nav-link ${activePage === "drafts" ? "is-active" : ""}`}
            onClick={() => setActivePage("drafts")}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" stroke="currentColor" strokeWidth="2" />
              <path d="M7 8h6M7 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>My Drafts</span>
          </button>
        </nav>
        <div className="sidebar__footer" style={{ marginTop: "auto", padding: "1rem 0 0.5rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="eyebrow" style={{ marginBottom: "0.25rem" }}>Draft</p>
          <p className="status" style={{ margin: 0 }}>
            {draftStatus === "saving"
              ? "Saving..."
              : draftStatus === "error"
                ? "Save failed"
                : draftStatus === "saved" && lastDraftSavedAt
                  ? `Saved ${new Date(lastDraftSavedAt).toLocaleTimeString()}`
                  : "Not saved yet"}
          </p>
        </div>
      </aside>
      <main className="content">
        {processingMessage && (
          <div className="processing-overlay">
            <div className="processing-indicator">
              <div className="processing-indicator__spinner">
                <svg width="40" height="40" viewBox="0 0 40 40" className="spinner">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="80" strokeDashoffset="20" strokeLinecap="round" />
                </svg>
              </div>
              <div className="processing-indicator__text">
                <p className="processing-indicator__message">{processingMessage}</p>
                {matching && (
                  <div className="processing-indicator__progress">
                    <div className="progress-bar">
                      <div
                        className="progress-bar__fill"
                        style={{ width: `${Math.min(((loadingStage + 1) / loadingMessages.length) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="progress-text">Step {Math.min(loadingStage + 1, loadingMessages.length)} of {loadingMessages.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {boqCompareLoading && (
          <div className="processing-overlay" style={{ zIndex: 3500 }}>
            <div className="processing-indicator">
              <div className="processing-indicator__spinner">
                <svg width="40" height="40" viewBox="0 0 40 40" className="spinner">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="80" strokeDashoffset="20" strokeLinecap="round" />
                </svg>
              </div>
              <div className="processing-indicator__text">
                <p className="processing-indicator__message">{compareMessages[compareStage] || compareMessages[0]}</p>
                <div className="processing-indicator__progress">
                  <div className="progress-bar">
                    <div className="progress-bar__fill" style={{ width: `${((compareStage + 1) / compareMessages.length) * 100}%` }} />
                  </div>
                  <span className="progress-text">Step {compareStage + 1} of {compareMessages.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <header className="hero">
          <div>
            <h1>{heroTitle}</h1>
          </div>
          <div style={{ position: "relative" }} ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="user-menu-trigger"
              aria-label="User menu"
              aria-expanded={isUserMenuOpen}
            >
              <div className="user-avatar">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <span className="user-menu-username">{user?.username || "User"}</span>
              <svg 
                width="12" 
                height="12" 
                viewBox="0 0 16 16" 
                fill="none"
                style={{
                  transform: isUserMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease"
                }}
              >
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isUserMenuOpen && (
              <div className="user-menu-dropdown">
                <div className="user-menu-header">
                  <div className="user-avatar user-avatar--large">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="user-menu-info">
                    <p className="user-menu-name">{user?.username || "User"}</p>
                    <p className="user-menu-email">{user?.email || ""}</p>
                  </div>
                </div>
                <div className="user-menu-divider"></div>
                <button
                  type="button"
                  className="user-menu-item user-menu-item--danger"
                  onClick={async () => {
                    setIsUserMenuOpen(false);
                    await logout();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                    <path d="M6 2H4a2 2 0 00-2 2v12a2 2 0 002 2h2M12 2h2a2 2 0 012 2v12a2 2 0 01-2 2h-2M6 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {activePage === "new-estimate" && (
          <div className="stepper" role="navigation" aria-label="Estimate workflow">
            {ESTIMATE_STEPS.map((step, idx) => {
              const status = getStepStatus(step.id);
              const isClickable = canNavigateToStep(step.id);
              return (
                <div className="stepper__segment" key={step.id}>
                  <button
                    type="button"
                    className={`stepper__item stepper__item--${status} ${isClickable ? "is-clickable" : "is-disabled"}`}
                    onClick={() => handleStepChange(step.id)}
                    disabled={!isClickable}
                    aria-current={status === "current" ? "step" : undefined}
                  >
                    <span className={`stepper__circle ${status === "complete" ? "is-complete" : ""}`}>
                      {status === "complete" ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <span className="stepper__meta">
                      <span className="stepper__label">{step.label}</span>
                      <span className="stepper__desc">{step.description}</span>
                    </span>
                  </button>
                  {idx < ESTIMATE_STEPS.length - 1 && (
                    <div
                      className={`stepper__connector ${STEP_ORDER[step.id] < STEP_ORDER[activeEstimateStep] ? "is-complete" : ""}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activePage === "knowledge" && (
          <section id="knowledge" className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Knowledge Base</p>
                <h2>Estimates Library</h2>
              </div>
              <button type="button" onClick={() => refreshHistory()} disabled={loadingHistory}>
                {loadingHistory ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {loadingHistory ? (
              <div className="loading-container">
                <div className="loading-spinner">
                  <svg width="48" height="48" viewBox="0 0 48 48" className="spinner">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="100" strokeDashoffset="25" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="loading-text">Loading Knowledge Base...</p>
              </div>
            ) : knowledgeBase.length === 0 ? (
              <p className="empty-state">No builds yet. Upload one to get started.</p>
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="kb-table kb-table--compact resizable-table">
                    <thead>
                      <tr>
                        <ResizableTh resize={kbResize} index={0} className="kb-table__col-filename">File Name</ResizableTh>
                        <ResizableTh resize={kbResize} index={1} className="kb-table__col-date">Date</ResizableTh>
                        <ResizableTh resize={kbResize} index={2}>CPU</ResizableTh>
                        <ResizableTh resize={kbResize} index={3}>CPU Cooler</ResizableTh>
                        <ResizableTh resize={kbResize} index={4}>Motherboard</ResizableTh>
                        <ResizableTh resize={kbResize} index={5}>Memory</ResizableTh>
                        <ResizableTh resize={kbResize} index={6}>Storage</ResizableTh>
                        <ResizableTh resize={kbResize} index={7}>Video Card</ResizableTh>
                        <ResizableTh resize={kbResize} index={8}>Case</ResizableTh>
                        <ResizableTh resize={kbResize} index={9}>Power Supply</ResizableTh>
                        <ResizableTh resize={kbResize} index={10}>Operating System</ResizableTh>
                        <ResizableTh resize={kbResize} index={11}>Monitor</ResizableTh>
                        <ResizableTh resize={kbResize} index={12} className="kb-table__col-price">Price</ResizableTh>
                        <ResizableTh resize={kbResize} index={13} className="kb-table__col-id">ID</ResizableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {knowledgeBase.map((build) => (
                        <tr
                          key={build.id}
                          onClick={() => handleRowClick(build.link_to_file)}
                          className="kb-table__row"
                        >
                        <td className="kb-table__filename">{renderCell(build.originalName)}</td>
                        <td className="kb-table__date">{renderCell(new Date(build.createdAt).toLocaleDateString())}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.CPU || build.attributes.cpu))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes["CPU Cooler"]))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.Motherboard))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.Memory || build.attributes.memory))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.Storage || build.attributes.storage))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes["Video Card"] || build.attributes.gpu))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.Case))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes["Power Supply"]))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes["Operating System"]))}</td>
                        <td>{renderCell(getAttributeValue(build.attributes.Monitor))}</td>
                        <td className="kb-table__price">{renderCell(build.totalPrice || "—")}</td>
                        <td className="kb-table__id">{renderCell(build.requestId.slice(0, 8))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1 || loadingHistory}
                  >
                    Previous
                  </button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || loadingHistory}
                  >
                    Next
                  </button>
                </div>
              </>
            )}

            <div className="panel__footer">
              <button
                type="button"
                className="btn-upload"
                onClick={() => setIsUploadModalOpen(true)}
              >
                + Add to the Knowledge Base
              </button>
            </div>
          </section>
        )}

        {activePage === "drafts" && (
          <section id="drafts" className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Drafts</p>
                <h2>My Drafts</h2>
              </div>
              <div className="upload-actions" style={{ gap: "0.5rem" }}>
                <button type="button" onClick={() => refreshDrafts()} disabled={draftsLoading}>
                  {draftsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            {draftsLoading ? (
              <div className="loading-container">
                <div className="loading-spinner">
                  <svg width="48" height="48" viewBox="0 0 48 48" className="spinner">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="100" strokeDashoffset="25" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="loading-text">Loading drafts...</p>
              </div>
            ) : drafts.length === 0 ? (
              <p className="empty-state">No drafts saved yet. Start an estimate to create one.</p>
            ) : (
              <div className="table-wrapper table-wrapper--no-x">
                <table className="kb-table kb-table--compact resizable-table">
                  <thead>
                    <tr>
                      <ResizableTh resize={kbResize} index={0} className="kb-table__col-filename">Name</ResizableTh>
                      <ResizableTh resize={kbResize} index={1} className="kb-table__col-date">Last Updated</ResizableTh>
                      <ResizableTh resize={kbResize} index={2}>Step</ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((draft) => {
                      const isSelected = selectedDraftId === draft.id;
                      return (
                        <tr
                          key={draft.id}
                          onClick={() => setSelectedDraftId(draft.id)}
                          className={`kb-table__row ${isSelected ? "is-active" : ""}`}
                          style={isSelected ? { backgroundColor: "rgba(76,110,245,0.08)" } : undefined}
                        >
                          <td className="kb-table__filename">{renderCell(draft.name)}</td>
                          <td className="kb-table__date">{renderCell(new Date(draft.updatedAt).toLocaleString())}</td>
                          <td>{renderCell(draft.step)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="panel__footer" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-match"
                onClick={handleContinueDraft}
                disabled={!selectedDraftId || loadingDraft}
              >
                {loadingDraft ? "Opening…" : "Continue"}
              </button>
            </div>
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "review" && (
          <section id="review" className="panel">
            <div className="panel__header">
              <div>
                <h2 className="review-title">Review Extraction</h2>
              </div>
              <div className="upload-actions">
                <button
                  type="button"
                  className="btn-match"
                  onClick={handleProceedFromReview}
                  disabled={boqCompareLoading}
                >
                  {hasDrawingData && hasBoqData ? "Compare" : "Finalize items"}
                </button>
              </div>
            </div>
            <div className="review-grid">
              {hasDrawingData && (
                <div className="review-block">
                  <p className="eyebrow">Extracted Items from Drawings</p>
                  <div className="table-wrapper">
                    <table className="matches-table resizable-table">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Size</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawingItemsFlat.map((item, idx) => (
                          <tr key={`review-drawings-${idx}`} className="matches-table__row">
                            <td>{renderCell(item.description || item.full_description)}</td>
                            <td>{renderCell(item.size)}</td>
                            <td>{renderCell(item.quantity)}</td>
                            <td>{renderCell(item.unit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {hasBoqData && (
                <div className="review-block">
                  <p className="eyebrow">Extracted BOQ Items</p>
                  <BoqItemsTable items={boqResults.boqItems} />
                </div>
              )}
            </div>
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "compare" && (
          <section id="compare" className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Comparison</p>
                <h2>Press on a row to include, or choose the source from the dropdown</h2>
              </div>
            </div>
            {boqResults.comparisons.length > 0 ? (
              <>
              <div className="table-wrapper table-wrapper--no-x" style={{ marginTop: "1.25rem" }}>
                <table className="matches-table resizable-table">
                  <thead>
                    <tr>
                      <th />
                      <ResizableTh resize={comparisonResize} index={0}>BOQ item</ResizableTh>
                      <ResizableTh resize={comparisonResize} index={1}>Drawing item</ResizableTh>
                      <ResizableTh resize={comparisonResize} index={2}>Action</ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {boqResults.comparisons.map((row, idx) => (
                      <tr key={`combined-compare-${idx}`} className={getComparisonClass(row.status)}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!comparisonChecked[idx]}
                            onChange={(e) => handleComparisonCheck(idx, e.target.checked)}
                          />
                        </td>
                        <td
                          className={`selectable-cell ${row.boq_item ? "is-clickable" : "is-disabled"} ${
                            comparisonSelections[idx] === "boq" ? "is-selected" : ""
                          }`}
                          onClick={() => handleComparisonCellSelect(idx, "boq", !!row.boq_item)}
                        >
                          {renderCell(
                            row.boq_item
                              ? `${row.boq_item.description || "—"} (${row.boq_item.quantity || "?"} ${row.boq_item.unit || ""}${row.boq_item.size ? `, ${row.boq_item.size}` : ""})`
                              : "—"
                          )}
                        </td>
                        <td
                          className={`selectable-cell ${row.drawing_item ? "is-clickable" : "is-disabled"} ${
                            comparisonSelections[idx] === "drawing" ? "is-selected" : ""
                          }`}
                          onClick={() => handleComparisonCellSelect(idx, "drawing", !!row.drawing_item)}
                        >
                          {renderCell(
                            row.drawing_item
                              ? `${row.drawing_item.description || "—"} (${row.drawing_item.quantity || "?"} ${row.drawing_item.unit || ""}${row.drawing_item.size ? `, ${row.drawing_item.size}` : ""})`
                              : "—"
                          )}
                        </td>
                        <td>
                          {row.status === "match_exact" ? null : (
                            <select
                              className="form-input form-input--table"
                              value={comparisonSelections[idx] || ""}
                              onChange={(e) => handleComparisonSelect(idx, e.target.value as "drawing" | "boq")}
                            >
                              <option value="">Choose source</option>
                              {row.boq_item && <option value="boq">Select from BOQ</option>}
                              {row.drawing_item && <option value="drawing">Select from Drawings</option>}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-actions" style={{ paddingTop: "0.75rem" }}>
                <button
                  type="button"
                  className={`btn-match ${hasAnyComparisonChecked && hasMissingComparisonSelection ? "is-disabled" : ""}`}
                  onClick={() => {
                    if (hasAnyComparisonChecked && hasMissingComparisonSelection) {
                      setFeedback("Choose a source (BOQ or Drawing) for each selected row.");
                      setTimeout(() => setFeedback(""), 3000);
                      return;
                    }
                    const selections: Array<{ item: ExtractedItem; source: "drawing" | "boq" }> = [];
                    let missingSource = false;
                    boqResults.comparisons.forEach((row, idx) => {
                      if (!comparisonChecked[idx]) return;
                      if (row.status === "match_exact") {
                        if (row.boq_item) selections.push({ item: row.boq_item, source: "boq" });
                        else if (row.drawing_item) selections.push({ item: row.drawing_item, source: "drawing" });
                        return;
                      }
                      const chosen = comparisonSelections[idx];
                      if (!chosen) {
                        missingSource = true;
                        return;
                      }
                      if (chosen === "boq" && row.boq_item) selections.push({ item: row.boq_item, source: "boq" });
                      if (chosen === "drawing" && row.drawing_item) selections.push({ item: row.drawing_item, source: "drawing" });
                    });
                    if (missingSource) {
                      setFeedback("Select source for all checked rows (unless they are auto-matched).");
                      setTimeout(() => setFeedback(""), 3000);
                      return;
                    }
                    setFinalizeItems(selections);
                    setActiveEstimateStep("finalize");
                  }}
                >
                  Finalize
                </button>
              </div>
              </>
            ) : (
              <p className="empty-state">No comparisons yet.</p>
            )}
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "finalize" && (
          <section id="finalize" className="panel">
            <EditableItemsTable
              items={finalizeItems}
              onChange={setFinalizeItems}
              title=""
              onAddRow={() => setFinalizeItems(prev => [...prev, { item: {}, source: "manual" }])}
            />
            <div className="table-actions">
              <button type="button" className="btn-match btn-outline">
                Go to Pricing
              </button>
            </div>
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "upload" && (
          <section id="matches" className="panel">
            <div className="panel__header">
              <div>
                <h2 className="section-title section-title--compact">Upload Drawings, BOQ, or both</h2>
              </div>
              <span className="status">{matching ? "Processing…" : "Idle"}</span>
            </div>
            <form className="estimate-form" onSubmit={handleExtract}>
              <div className="uploaders-grid">
                <label className="dropzone dropzone--estimate uploader-card">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    multiple
                    onChange={(event) => {
                      setMatchingFiles(Array.from(event.target.files || []));
                      setReviewStepActive(false);
                    }}
                  />
                  <div className="dropzone__content">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="dropzone__icon">
                      <path d="M24 16v16M16 24h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <p className="dropzone__text">
                      {matchingFiles.length
                        ? `${matchingFiles.length} drawing file(s): ${matchingFiles.map(f => f.name).join(", ")}`
                        : "Drag & drop or browse drawings (PDF, DOCX, TXT)"}
                    </p>
                    <p className="dropzone__hint">You can upload multiple drawing files together.</p>
                  </div>
                </label>

                <label className="dropzone dropzone--estimate uploader-card">
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.xlsx,.xls,.csv"
                    onChange={(event) => {
                      handleBoqFileChange(event);
                      setReviewStepActive(false);
                    }}
                  />
                  <div className="dropzone__content">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="dropzone__icon">
                      <path d="M14 16h20M14 22h20M14 28h14M10 12h2v24h-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="dropzone__text">
                      {selectedBoqFileName
                        ? `BOQ selected: ${selectedBoqFileName}`
                        : "Drag & drop or browse BOQ (PDF, Excel, Images)"}
                    </p>
                    <p className="dropzone__hint">Single BOQ file; extraction runs when you review.</p>
                  </div>
                </label>
              </div>
              <div className="upload-actions">
                <button
                  type="submit"
                  className="btn-match"
                  disabled={
                    matching ||
                    boqExtractLoading ||
                    (!matchingFiles.length && !pendingBoqFile)
                  }
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
                    <path d="M13 13l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {matching || boqExtractLoading ? "Processing…" : "Review Extraction"}
                </button>
              </div>
            </form>

            {pricingSelections.length > 0 && (
              <div className="table-wrapper" style={{ marginTop: "1rem" }}>
                <div className="panel__header" style={{ marginBottom: "0.5rem" }}>
                  <p className="eyebrow">Pricing</p>
                  <h4>Items to Price</h4>
                </div>
                <table className="matches-table resizable-table">
                  <thead>
                    <tr>
                      <ResizableTh resize={pricingResize} index={0}>Item</ResizableTh>
                      <ResizableTh resize={pricingResize} index={1}>Quantity</ResizableTh>
                      <ResizableTh resize={pricingResize} index={2}>Unit</ResizableTh>
                      <ResizableTh resize={pricingResize} index={3}>Source</ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingSelections.map((sel, idx) => (
                      <tr key={`pricing-${idx}`} className="matches-table__row">
                        <td>{renderCell(sel.item.description || sel.item.full_description)}</td>
                        <td>{renderCell(sel.item.quantity)}</td>
                        <td>{renderCell(sel.item.unit)}</td>
                        <td>
                          <span className={`pill ${sel.source === "drawing" ? "pill--blue" : "pill--green"}`}>
                            {sel.source === "drawing" ? "Drawing" : "BOQ"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {feedback && <p className="feedback">{feedback}</p>}
      </main>

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => {
          refreshHistory();
          loadStats();
        }}
      />

      <TemplateEditorModal
        isOpen={isTemplateEditorOpen}
        onClose={() => setIsTemplateEditorOpen(false)}
        onSuccess={() => {
          refreshHistory();
          loadStats();
          setFeedback("Build saved successfully!");
          setTimeout(() => setFeedback(""), 3000);
        }}
        initialAttributes={selectedTemplateAttributes}
      />
      <button
        type="button"
        className={`sidebar-toggle sidebar-toggle--floating ${isSidebarOpen ? "is-open" : ""}`}
        onClick={() => setIsSidebarOpen(prev => !prev)}
        aria-label={isSidebarOpen ? "Hide navigation menu" : "Show navigation menu"}
        aria-pressed={isSidebarOpen}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {isSidebarOpen ? (
            <path d="M6 4l8 6-8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M14 4l-8 6 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>
    </div>
  );
}

export default App;
