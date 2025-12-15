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
  PriceMapping,
  PriceListRow,
  AtgTotals,
  ElectricalTotals,
  ElectricalCalcRequest,
  InstallationInputs,
  InstallationLocation,
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
  enrichBoqItems,
  listDrafts,
  saveDraft,
  getDraft,
  priceMap,
  fetchPriceList,
  fetchAtgTotals,
  fetchElectricalTotals,
  calculateElectrical,
} from "./services/api";
import { useAuth } from "./contexts/AuthContext";

const ITEMS_PER_PAGE = 10;
const COMPANY_LOGO_URL = "/company.png";
const COMPANY_NAME = "Nesma & Partners";
const CONTACT_NAME = "Abdel Rahman Thalji";

const ESTIMATE_STEPS: Array<{ id: EstimateStep; label: string; description: string }> = [
  { id: "upload", label: "Upload", description: "Drawings & BOQ" },
  { id: "review", label: "Review", description: "Validate extraction" },
  { id: "compare", label: "Compare", description: "BOQ vs drawings" },
  { id: "finalize", label: "Prepare", description: "Prep for pricing" },
  { id: "pricing", label: "Pricing", description: "Review prices" },
  { id: "estimate", label: "Finalize", description: "Assemble estimate" },
];

const STEP_ORDER: Record<EstimateStep, number> = {
  upload: 0,
  review: 1,
  compare: 2,
  finalize: 3,
  pricing: 4,
  estimate: 5,
};

type AppPage = "knowledge" | "new-estimate" | "drafts";
type PricingAccordionId = "items" | "electrical" | "atg" | "installation";

const PRICING_SECTIONS: Array<{ id: PricingAccordionId; label: string }> = [
  { id: "items", label: "Items" },
  { id: "electrical", label: "Electrical" },
  { id: "atg", label: "ATG" },
  { id: "installation", label: "Installation" },
];

const ELECTRICAL_INPUT_DEFAULTS: Array<{ key: string; label: string; value: number }> = [
  { key: "a2", label: "Tanks total quantity (A2)", value: 0 },
  { key: "x", label: "Between Storage Tank and Control Panel", value: 30 },
  { key: "y", label: "Between Day tank and Control Panel", value: 100 },
  { key: "z", label: "Between Filling Point and Control Panel", value: 100 },
  { key: "c5", label: "Single Submersible Pump", value: 1 },
  { key: "c6", label: "Duplex Gear Pump", value: 0 },
  { key: "c7", label: "Magnetic Float Switch (Storage Tank)", value: 1 },
  { key: "c8", label: "Level Probe EDM-40 (Storage Tank)", value: 1 },
  { key: "c9", label: "Oil Leak Detection Sensor (Storage Tank)", value: 1 },
  { key: "c10", label: "Flow Meter", value: 0 },
  { key: "c11", label: "Solenoid Valve Parker #1", value: 1 },
  { key: "c12", label: "Solenoid Valve Parker #2", value: 0 },
  { key: "c13", label: "Solenoid Valve Parker #3", value: 0 },
  { key: "c14", label: "Magnetic Float Switch (Day Tank) #1", value: 1 },
  { key: "c15", label: "Magnetic Float Switch (Day Tank) #2", value: 0 },
  { key: "c16", label: "Magnetic Float Switch (Day Tank) #3", value: 0 },
  { key: "c17", label: "Level Probe EDM-40 (Day Tank) #1", value: 1 },
  { key: "c18", label: "Level Probe EDM-40 (Day Tank) #2", value: 0 },
  { key: "c19", label: "Level Probe EDM-40 (Day Tank) #3", value: 0 },
  { key: "c20", label: "Oil Leak Detection Sensor (Day Tank) #1", value: 1 },
  { key: "c21", label: "Oil Leak Detection Sensor (Day Tank) #2", value: 0 },
  { key: "c22", label: "Oil Leak Detection Sensor (Day Tank) #3", value: 0 },
  { key: "c23", label: "Overfill Alarm Unit (Storage Tank)", value: 1 },
  { key: "c24", label: "ATG Console", value: 0 },
  { key: "c25", label: "Remote Annunciator", value: 0 },
];

const buildDefaultAtgRow = () => ({
  description: "ATG System",
  qty: "1",
  unit: "Lot",
  unitPrice: "",
  totalPrice: "",
  unitManhour: "",
  totalManhour: "",
});

const buildDefaultElectricalRow = () => ({
  description: "Electrical System",
  qty: "1",
  unit: "Lot",
  unitPrice: "",
  totalPrice: "",
  unitManhour: "",
  totalManhour: "",
});

const buildDefaultElectricalInputs = () =>
  ELECTRICAL_INPUT_DEFAULTS.reduce<Record<string, string>>((acc, curr) => {
    acc[curr.key] = curr.value.toString();
    return acc;
  }, {});

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

function matchesDescription(item: Pick<ExtractedItem, "description" | "full_description">, query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return `${item.description || ""} ${item.full_description || ""}`.toLowerCase().includes(search);
}

function buildFinalizeEntry<S extends ItemSource>(item: ExtractedItem, source: S, fallback?: ExtractedItem): { item: ExtractedItem; source: S } {
  if (source === "boq") {
    return { item: { ...item }, source };
  }
  const normalizedSize = item.size ?? fallback?.size;
  const normalizedCapacity = item.capacity ?? fallback?.capacity;
  const normalizedItem: ExtractedItem = { ...item };
  if (normalizedSize) normalizedItem.size = normalizedSize;
  if (normalizedCapacity) normalizedItem.capacity = normalizedCapacity;
  return { item: normalizedItem, source };
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

function EditableItemsTable({
  items,
  onChange,
  title,
  searchQuery,
  onSearchChange,
}: {
  items: Array<{ item: ExtractedItem; source: ItemSource }>;
  onChange: (next: Array<{ item: ExtractedItem; source: ItemSource }>) => void;
  title: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}) {
  const handleChange = (idx: number, field: keyof ExtractedItem, value: string) => {
    const next = [...items];
    next[idx] = { ...next[idx], item: { ...next[idx].item, [field]: value } };
    onChange(next);
  };

  const filteredItems = useMemo(
    () =>
      items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => matchesDescription(item.item, searchQuery)),
    [items, searchQuery]
  );

  return (
    <div className="table-wrapper">
      <div className="panel__header" style={{ marginBottom: "0.5rem", alignItems: "flex-end", gap: "0.75rem" }}>
        {title && <p className="eyebrow">{title}</p>}
        <div style={{ marginLeft: "auto" }}>
          <input
            className="form-input form-input--table"
            placeholder="Search description…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ width: "240px" }}
          />
        </div>
      </div>
      <table className="matches-table resizable-table finalize-table">
        <thead>
          <tr>
            <th className="finalize-col finalize-col--description">Description</th>
            <th className="finalize-col finalize-col--capacity">Capacity</th>
            <th className="finalize-col finalize-col--size">Size</th>
            <th className="finalize-col finalize-col--qty">Quantity</th>
            <th className="finalize-col finalize-col--unit">Unit</th>
            <th className="finalize-col finalize-col--source">Source</th>
          </tr>
        </thead>
        <tbody>
          {filteredItems.length ? filteredItems.map(({ item, idx }) => (
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
              <td className="finalize-col finalize-col--capacity">
                <input
                  className="form-input form-input--table"
                  value={item.item.capacity || ""}
                  onChange={(e) => handleChange(idx, "capacity", e.target.value)}
                  placeholder="Capacity"
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
          )) : (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "rgba(227,233,255,0.7)" }}>
                No items match this description search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
  const [boqEnrichLoading, setBoqEnrichLoading] = useState(false);
  const [selectedBoqFileName, setSelectedBoqFileName] = useState<string>("");
  const [pendingBoqFile, setPendingBoqFile] = useState<File | null>(null);
  const [reviewStepActive, setReviewStepActive] = useState(false);
  const [finalizeItems, setFinalizeItems] = useState<Array<{ item: ExtractedItem; source: ItemSource }>>([]);
  const [drawingSearch, setDrawingSearch] = useState("");
  const [boqSearch, setBoqSearch] = useState("");
  const [finalizeSearch, setFinalizeSearch] = useState("");
  const [comparisonSelections, setComparisonSelections] = useState<Record<number, "drawing" | "boq" | "">>({});
  const [comparisonChecked, setComparisonChecked] = useState<Record<number, boolean>>({});
  const [pricingSelections, setPricingSelections] = useState<Array<{ source: ItemSource; item: ExtractedItem }>>([]);
  const [pricingSearch, setPricingSearch] = useState("");
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingStatus, setPricingStatus] = useState<string>("");
  const [pricingMatchOptions, setPricingMatchOptions] = useState<Record<number, PriceMapping[]>>({});
  const [pricingMatchChoice, setPricingMatchChoice] = useState<Record<number, number>>({});
  const pricingSelectRefs = useRef<Record<number, HTMLSelectElement | null>>({});
  const pricingTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pricingDropdownRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [pricingDropdownPos, setPricingDropdownPos] = useState<
    Record<number, { top: number; left: number; width: number }>
  >({});
  const [pricingDropdownOpen, setPricingDropdownOpen] = useState<Record<number, boolean>>({});
  const [priceList, setPriceList] = useState<PriceListRow[]>([]);
  const [priceListLoading, setPriceListLoading] = useState(false);
  const [priceListError, setPriceListError] = useState("");
  const [priceListSearch, setPriceListSearch] = useState<Record<number, string>>({});
  const filteredPricingSelections = useMemo(
    () => pricingSelections.map((sel, idx) => ({ sel, idx })).filter(({ sel }) => matchesDescription(sel.item, pricingSearch)),
    [pricingSelections, pricingSearch]
  );
  const [atgRow, setAtgRow] = useState<{
    description: string;
    qty: string;
    unit: string;
    unitPrice: string;
    totalPrice: string;
    unitManhour: string;
    totalManhour: string;
  }>(() => buildDefaultAtgRow());
  const [atgLoading, setAtgLoading] = useState(false);
  const [atgError, setAtgError] = useState<string>("");
  const [electricalRow, setElectricalRow] = useState<{
    description: string;
    qty: string;
    unit: string;
    unitPrice: string;
    totalPrice: string;
    unitManhour: string;
    totalManhour: string;
  }>(() => buildDefaultElectricalRow());
  const [electricalLoading, setElectricalLoading] = useState(false);
  const [electricalError, setElectricalError] = useState<string>("");
  const [electricalModalOpen, setElectricalModalOpen] = useState(false);
  const [electricalInputs, setElectricalInputs] = useState<Record<string, string>>(buildDefaultElectricalInputs);
  const [installationInputs, setInstallationInputs] = useState<InstallationInputs>({
    workers: "0",
    engineers: "0",
    supervisors: "0",
    location: "riyadh",
  });
  const [minSellingPrice, setMinSellingPrice] = useState("500000");
  const [estimateDiscountPct, setEstimateDiscountPct] = useState("0");
  const [estimateCompanyName, setEstimateCompanyName] = useState(COMPANY_NAME);
  const [estimateContactName, setEstimateContactName] = useState(CONTACT_NAME);
  const [estimateProjectName, setEstimateProjectName] = useState("");
  const [estimateSubject, setEstimateSubject] = useState("");
  const [showDrawingsOnlyConfirm, setShowDrawingsOnlyConfirm] = useState(false);

  const getMatchLabel = useCallback((match?: PriceMapping) => {
    if (!match) return "Select price";
    const row = (match.price_row || {}) as Record<string, string | number>;
    return (
      (row["Item"] as string) ||
      (row["Name"] as string) ||
      (row["Description"] as string) ||
      `Match ${match.price_list_index + 1}`
    );
  }, []);

  const getPriceListItemLabel = useCallback((row?: PriceListRow) => {
    if (!row) return "";
    const itemValue = row["Item"] ?? row["item"];
    if (itemValue !== undefined && itemValue !== null && itemValue !== "") {
      return String(itemValue);
    }
    const keys = Object.keys(row);
    const fallbackKey = keys[1] ?? keys[0];
    return fallbackKey ? String(row[fallbackKey] ?? "") : "";
  }, []);

  const openMatchDropdown = (rowIdx: number) => {
    setPricingDropdownOpen((prev) => {
      const nextOpen = !prev[rowIdx];
      const trigger = pricingTriggerRefs.current[rowIdx];
      if (nextOpen && trigger) {
        const rect = trigger.getBoundingClientRect();
        const left = Math.min(rect.left, Math.max(8, window.innerWidth - 360));
        const width = rect.width;
        const top = rect.top + rect.height + 6;
        setPricingDropdownPos((pos) => ({
          ...pos,
          [rowIdx]: { top, left, width },
        }));
      }
      const sel = pricingSelectRefs.current[rowIdx];
      if (nextOpen && sel) {
        requestAnimationFrame(() => {
          sel.focus();
          if (typeof (sel as any).showPicker === "function") {
            (sel as any).showPicker();
          } else {
            sel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            sel.click();
          }
        });
      }
      return { ...prev, [rowIdx]: nextOpen };
    });
  };
  const closeMatchDropdown = useCallback((rowIdx?: number) => {
    if (rowIdx === undefined) {
      setPricingDropdownOpen({});
      return;
    }
    setPricingDropdownOpen((prev) => ({ ...prev, [rowIdx]: false }));
  }, []);

  const indexedPriceList = useMemo(
    () => priceList.map((row, idx) => ({ row, rowIndex: idx })),
    [priceList]
  );

  const findPriceListMatches = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < 3) return [];
      const lower = trimmed.toLowerCase();
      return indexedPriceList.filter(({ row }) => {
        const label = getPriceListItemLabel(row);
        return label && label.toLowerCase().includes(lower);
      });
    },
    [getPriceListItemLabel, indexedPriceList]
  );

  const applyPriceMappingToRow = (rowIdx: number, mapping: PriceMapping) => {
    const row = mapping.price_row as Record<string, string | number> | undefined;
    const rowPrice = pickFieldFromRow(row, [/price/i]);
    const rowMh = pickFieldFromRow(row, [/manhour/i, /mh/i]);
    setPricingSelections(prev => {
      const next = [...prev];
      if (!next[rowIdx]) return prev;
      const nextUnitPriceRaw =
        mapping.unit_price !== undefined ? String(mapping.unit_price) : rowPrice ?? next[rowIdx].item.unit_price;
      const nextUnitPrice = roundPrice(nextUnitPriceRaw);
      const nextUnitMh =
        mapping.unit_manhour !== undefined ? String(mapping.unit_manhour) : rowMh ?? next[rowIdx].item.unit_manhour;
      const quantity = next[rowIdx].item.quantity;
      next[rowIdx] = {
        ...next[rowIdx],
        item: {
          ...next[rowIdx].item,
          unit_price: nextUnitPrice,
          unit_manhour: nextUnitMh,
          total_price: computeTotalPrice(nextUnitPrice, quantity),
          total_manhour: computeTotalValue(nextUnitMh, quantity),
        },
      };
      return next;
    });
  };

  useEffect(() => {
    const handleOutsideInteraction = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      const openRows = Object.entries(pricingDropdownOpen)
        .filter(([, isOpen]) => isOpen)
        .map(([idx]) => Number(idx));
      if (!openRows.length) return;

      const clickedOutside = openRows.some((rowIdx) => {
        const container = pricingDropdownRefs.current[rowIdx];
        return container && !container.contains(target);
      });

      if (clickedOutside) {
        closeMatchDropdown();
      }
    };

    document.addEventListener("mousedown", handleOutsideInteraction);
    document.addEventListener("touchstart", handleOutsideInteraction);
    return () => {
      document.removeEventListener("mousedown", handleOutsideInteraction);
      document.removeEventListener("touchstart", handleOutsideInteraction);
    };
  }, [pricingDropdownOpen, closeMatchDropdown]);
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
  const [selectedDrawingRows, setSelectedDrawingRows] = useState<Record<string, boolean>>({});
  const [selectedBoqRows, setSelectedBoqRows] = useState<Record<string, boolean>>({});
  const kbResize = useColumnResize();
  const comparisonResize = useColumnResize();
  const pricingResize = useColumnResize();
  const estimateResize = useColumnResize();
  const [activePricingSection, setActivePricingSection] = useState<PricingAccordionId | null>("items");
  const compareMessages = [
    "Reading BOQ…",
    "Extracting BOQ items…",
    "Comparing with drawing items…",
    "Finalizing comparison…"
  ];
  const [compareStage, setCompareStage] = useState(0);

  useEffect(() => {
    if (activePage !== "new-estimate" || activeEstimateStep !== "pricing") return;
    if (priceList.length || priceListLoading) return;
    setPriceListLoading(true);
    setPriceListError("");
    fetchPriceList()
      .then(({ data }) => {
        setPriceList(data || []);
      })
      .catch((error) => {
        console.error("Failed to load price list", error);
        setPriceListError((error as Error).message || "Failed to load price list.");
      })
      .finally(() => setPriceListLoading(false));
  }, [activeEstimateStep, activePage, priceList.length, priceListLoading]);

  const hasDraftContent = useMemo(() => {
    return (
      extractedFiles.length > 0 ||
      boqResults.boqItems.length > 0 ||
      boqResults.comparisons.length > 0 ||
      finalizeItems.length > 0 ||
      pricingSelections.length > 0 ||
      Object.keys(comparisonSelections).length > 0 ||
      Object.keys(comparisonChecked).length > 0 ||
      Object.keys(selectedDrawingRows).length > 0 ||
      Object.keys(selectedBoqRows).length > 0 ||
      Boolean(selectedBoqFileName)
    );
  }, [
    extractedFiles,
    boqResults,
    finalizeItems,
    pricingSelections,
    comparisonSelections,
    comparisonChecked,
    selectedDrawingRows,
    selectedBoqRows,
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
      selectedDrawingRows,
      selectedBoqRows,
      finalizeItems,
      pricingSelections: pricingSelections as DraftEstimateState["pricingSelections"],
      pricingMatchOptions,
      pricingMatchChoice,
      selectedBoqFileName,
      atgRow,
      electricalRow,
      electricalInputs,
      installationInputs,
    };
  }, [
    activeEstimateStep,
    reviewStepActive,
    extractedFiles,
    boqResults,
    comparisonSelections,
    comparisonChecked,
    selectedDrawingRows,
    selectedBoqRows,
    finalizeItems,
    pricingSelections,
    pricingMatchOptions,
    pricingMatchChoice,
    selectedBoqFileName,
    atgRow,
    electricalRow,
    electricalInputs,
    installationInputs,
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
    "AI is Extracting the Attributes..."
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
    setActivePricingSection("items");
    setAtgRow(buildDefaultAtgRow());
    setAtgLoading(false);
    setAtgError("");
    setElectricalRow(buildDefaultElectricalRow());
    setElectricalInputs(buildDefaultElectricalInputs());
    setElectricalLoading(false);
    setElectricalError("");
    setElectricalModalOpen(false);
    setSelectedDrawingRows({});
    setSelectedBoqRows({});
    setFeedback("");
    setDraftId(null);
    setDraftName("");
    setSelectedDraftId(null);
    setDraftStatus("idle");
    setLastDraftSavedAt(null);
    setInstallationInputs({
      workers: "0",
      engineers: "0",
      supervisors: "0",
      location: "riyadh",
    });
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
      setBoqResults(state.boqResults || { boqItems: [], comparisons: [] });
      setComparisonSelections(toNumberRecord(state.comparisonSelections));
      setComparisonChecked(toNumberRecord(state.comparisonChecked));
      setFinalizeItems(state.finalizeItems || []);
      setPricingSelections(state.pricingSelections || []);
      setPricingMatchOptions(state.pricingMatchOptions || {});
      setPricingMatchChoice(toNumberRecord(state.pricingMatchChoice));
      setSelectedBoqFileName(state.selectedBoqFileName || "");
      if (state.atgRow) {
        setAtgRow(state.atgRow);
      }
      if (state.electricalRow) {
        setElectricalRow(state.electricalRow);
      }
      if (state.electricalInputs) {
        setElectricalInputs(state.electricalInputs);
      }
      if (hydratingDraftRef.current && state.installationInputs) {
        setInstallationInputs(state.installationInputs);
      }
      const defaultDrawingSelection: Record<string, boolean> = {};
      (state.extractedFiles || []).forEach((file, fileIdx) =>
        (file.items || []).forEach((_, itemIdx) => {
          defaultDrawingSelection[`d-${fileIdx}-${itemIdx}`] = true;
        })
      );
      const defaultBoqSelection: Record<string, boolean> = {};
      (state.boqResults?.boqItems || []).forEach((_, idx) => {
        defaultBoqSelection[`b-${idx}`] = true;
      });
      setSelectedDrawingRows(
        state.selectedDrawingRows && Object.keys(state.selectedDrawingRows).length > 0
          ? state.selectedDrawingRows
          : defaultDrawingSelection
      );
      setSelectedBoqRows(
        state.selectedBoqRows && Object.keys(state.selectedBoqRows).length > 0
          ? state.selectedBoqRows
          : defaultBoqSelection
      );
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

  // Note: handleProceedToPricing is not currently used - pricing selections are set in the Finalize button handler

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
            ? "Prepare the items before moving to Pricing"
            : activePage === "new-estimate" && activeEstimateStep === "pricing"
              ? "Finalize the Pricing for Items, Electrical, ATG and Installation"
              : activePage === "new-estimate" && activeEstimateStep === "estimate"
                ? "Finalize the consolidated estimate"
                : "Upload Drawings and BOQ to start the Estimation";

  const handleBoqFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPendingBoqFile(file);
    setSelectedBoqFileName(file.name);
  };

  const getComparisonClass = (status: string) => {
    const okStatuses = new Set(["match_exact", "exact_match", "match", "matched"]);
    const warnStatuses = new Set(["match_quantity_diff", "match_unit_diff", "partial_match", "match_size_diff"]);
    const missingStatuses = new Set(["missing_in_boq", "missing_in_drawing", "no_match"]);
    if (okStatuses.has(status)) return "compare-row--ok";
    if (warnStatuses.has(status)) return "compare-row--warn";
    if (missingStatuses.has(status)) return "compare-row--missing";
    return "";
  };

  const buildDrawingRowKey = (fileIdx: number, itemIdx: number) => `d-${fileIdx}-${itemIdx}`;
  const buildBoqRowKey = (itemIdx: number) => `b-${itemIdx}`;

  const drawingReviewRows = useMemo(
    () =>
      extractedFiles.flatMap((file, fileIdx) =>
        (file.items || []).map((item, itemIdx) => ({
          item,
          fileIdx,
          itemIdx,
          fileName: file.fileName,
          key: buildDrawingRowKey(fileIdx, itemIdx),
        }))
      ),
    [extractedFiles]
  );

  const boqReviewRows = useMemo(
    () =>
      (boqResults.boqItems || []).map((item, itemIdx) => ({
        item,
        itemIdx,
        key: buildBoqRowKey(itemIdx),
      })),
    [boqResults]
  );

  const filteredDrawingReviewRows = useMemo(
    () => drawingReviewRows.filter(({ item }) => matchesDescription(item, drawingSearch)),
    [drawingReviewRows, drawingSearch]
  );

  const filteredBoqReviewRows = useMemo(
    () => boqReviewRows.filter(({ item }) => matchesDescription(item, boqSearch)),
    [boqReviewRows, boqSearch]
  );

  const drawingSelectedCount = useMemo(
    () => filteredDrawingReviewRows.reduce((count, row) => count + (selectedDrawingRows[row.key] ? 1 : 0), 0),
    [filteredDrawingReviewRows, selectedDrawingRows]
  );

  const boqSelectedCount = useMemo(
    () => filteredBoqReviewRows.reduce((count, row) => count + (selectedBoqRows[row.key] ? 1 : 0), 0),
    [filteredBoqReviewRows, selectedBoqRows]
  );

  const setAllDrawingSelection = useCallback(
    (checked: boolean) => {
      setSelectedDrawingRows(prev => {
        const next = { ...prev };
        filteredDrawingReviewRows.forEach(row => {
          next[row.key] = checked;
        });
        return next;
      });
    },
    [filteredDrawingReviewRows]
  );

  const setAllBoqSelection = useCallback(
    (checked: boolean) => {
      setSelectedBoqRows(prev => {
        const next = { ...prev };
        filteredBoqReviewRows.forEach(row => {
          next[row.key] = checked;
        });
        return next;
      });
    },
    [filteredBoqReviewRows]
  );

  const hasDrawingData = drawingReviewRows.length > 0;
  const hasBoqData = boqReviewRows.length > 0;

  const buildBoqSelection = useCallback(
    (items: ExtractedItem[]) => {
      const rows = items.map((item, itemIdx) => ({
        item,
        key: buildBoqRowKey(itemIdx),
      }));
      const picked = rows.filter(row => selectedBoqRows[row.key]).map(row => row.item);
      return picked.length ? picked : items;
    },
    [selectedBoqRows]
  );

  const getSelectedDrawingItems = useCallback(
    () => {
      const picked = drawingReviewRows.filter(row => selectedDrawingRows[row.key]).map(row => row.item);
      return picked.length ? picked : drawingReviewRows.map(row => row.item);
    },
    [drawingReviewRows, selectedDrawingRows]
  );

  const getSelectedBoqItems = useCallback(
    (itemsOverride?: ExtractedItem[]) => {
      const items = itemsOverride ?? boqResults.boqItems ?? [];
      return buildBoqSelection(items);
    },
    [boqResults.boqItems, buildBoqSelection]
  );

  const enrichBoqSizeAndCapacity = useCallback(async (itemsArg?: ExtractedItem[]): Promise<ExtractedItem[]> => {
    const items = itemsArg ?? boqResults.boqItems ?? [];
    const needsEnrichment = items.some(item => {
      const hasSize = !!item.size && item.size.trim().length > 0;
      const hasCapacity = !!item.capacity && item.capacity.trim().length > 0;
      return !hasSize || !hasCapacity;
    });
    if (!needsEnrichment) return items;

    setBoqEnrichLoading(true);
    try {
      const resp = await enrichBoqItems(items);
      console.log("[boq-enrich] client received items:", resp.items?.length, "raw:", resp.rawContent?.slice?.(0, 200));
      if (resp.items?.length) {
        setBoqResults(prev => ({ ...prev, boqItems: resp.items, comparisons: [] }));
        setComparisonSelections({});
        setComparisonChecked({});
        // Ensure table shows enriched rows immediately
        const selection: Record<string, boolean> = {};
        resp.items.forEach((_, idx) => {
          selection[`b-${idx}`] = true;
        });
        setSelectedBoqRows(selection);
        return resp.items;
      }
    } catch (error) {
      setFeedback((error as Error).message || "Failed to enrich BOQ items.");
      setTimeout(() => setFeedback(""), 4000);
    } finally {
      setBoqEnrichLoading(false);
    }
    return items;
  }, [boqResults.boqItems]);

  const runExtract = useCallback(
    async (hasDrawings: boolean, hasBoq: boolean) => {
      setMatching(hasDrawings);
      setProcessingAI(hasDrawings);
      setReviewStepActive(false);
      setActiveEstimateStep("upload");
      setFeedback("");
      if (hasDrawings) {
        setExtractedFiles([]);
        setLoadingStage(0);
      }
      setSelectedDrawingRows({});
      setSelectedBoqRows({});

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
          const files = payload.files ?? [];
          setExtractedFiles(files);
          const drawingSelection: Record<string, boolean> = {};
          files.forEach((file, fileIdx) =>
            (file.items || []).forEach((_, itemIdx) => {
              drawingSelection[`d-${fileIdx}-${itemIdx}`] = true;
            })
          );
          setSelectedDrawingRows(drawingSelection);
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
            let boqItems = extractResp.boqItems || [];
            boqItems = await enrichBoqSizeAndCapacity(boqItems);
            setBoqResults({ boqItems, comparisons: [] });
            const boqSelection: Record<string, boolean> = {};
            boqItems.forEach((_, idx) => {
              boqSelection[`b-${idx}`] = true;
            });
            setSelectedBoqRows(boqSelection);
            boqSucceeded = !!(boqItems && boqItems.length > 0);
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
    },
    [enrichBoqSizeAndCapacity, loadingMessages.length, matchingFiles, pendingBoqFile]
  );

  const handleExtract = async (event: React.FormEvent, skipConfirm?: boolean) => {
    event.preventDefault();
    const hasDrawings = matchingFiles.length > 0;
    const hasBoq = !!pendingBoqFile;

    if (!hasDrawings && !hasBoq) {
      setFeedback("Upload drawings or BOQ to start a review.");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }

    if (hasDrawings && !hasBoq && !skipConfirm) {
      setShowDrawingsOnlyConfirm(true);
      return;
    }

    await runExtract(hasDrawings, hasBoq);
  };

  const handleConfirmDrawingsOnly = useCallback(async () => {
    setShowDrawingsOnlyConfirm(false);
    await runExtract(true, false);
  }, [runExtract]);

  const handleCancelDrawingsOnly = useCallback(() => {
    setShowDrawingsOnlyConfirm(false);
  }, []);

  const updateDrawingItemField = useCallback(
    (fileIdx: number, itemIdx: number, field: keyof ExtractedItem, value: string) => {
      setExtractedFiles(prev => {
        if (!prev[fileIdx]) return prev;
        const next = [...prev];
        const file = next[fileIdx];
        const items = [...(file.items || [])];
        items[itemIdx] = { ...items[itemIdx], [field]: value };
        next[fileIdx] = { ...file, items };
        return next;
      });
      // Edited data invalidates previous comparisons
      setBoqResults(prev => ({ ...prev, comparisons: [] }));
      setComparisonSelections({});
      setComparisonChecked({});
    },
    []
  );

  const updateBoqItemField = useCallback(
    (itemIdx: number, field: keyof ExtractedItem, value: string) => {
      setBoqResults(prev => {
        const items = [...(prev.boqItems || [])];
        if (!items[itemIdx]) return prev;
        items[itemIdx] = { ...items[itemIdx], [field]: value };
        return { ...prev, boqItems: items, comparisons: [] };
      });
      setComparisonSelections({});
      setComparisonChecked({});
    },
    []
  );


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
      case "pricing":
        return pricingSelections.length > 0 || finalizeItems.length > 0 || activeEstimateStep === "pricing";
      case "estimate":
        return pricingSelections.length > 0 || finalizeItems.length > 0 || activeEstimateStep === "estimate";
      default:
        return false;
    }
  };

  const computeTotalPrice = (unitPrice: string | number | undefined, quantity: string | undefined) => {
    const qty = Number(quantity ?? "0");
    const price = Number(unitPrice ?? "0");
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return "";
    return (price * qty).toFixed(2);
  };

  const roundPrice = (value: string | number | undefined) => {
    if (value === undefined || value === null) return "";
    const num = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
    if (!Number.isFinite(num)) return value.toString();
    return num.toFixed(2);
  };

  const computeTotalValue = (unitValue: string | number | undefined, quantity: string | undefined) => {
    const qty = Number(quantity ?? "0");
    const value = Number(unitValue ?? "0");
    if (!Number.isFinite(qty) || !Number.isFinite(value)) return "";
    return (value * qty).toFixed(2);
  };

  const parseNumeric = (value: string | number | undefined) => {
    if (value === undefined || value === null) return 0;
    const normalised = typeof value === "string" ? value.replace(/,/g, "") : value;
    const num = Number(normalised);
    return Number.isFinite(num) ? num : 0;
  };

  const formatNumber = (value: number) => {
    return Number.isFinite(value)
      ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  };

  const totalManhour = useMemo(() => {
    // Total manhour = items (items accordion) + ATG + Electrical
    const itemsMh = pricingSelections.reduce((sum, entry) => {
      return sum + parseNumeric(entry.item.total_manhour);
    }, 0);
    const atgMh = parseNumeric(atgRow.totalManhour);
    const electricalMh = parseNumeric(electricalRow.totalManhour);
    return itemsMh + atgMh + electricalMh;
  }, [pricingSelections, atgRow.totalManhour, electricalRow.totalManhour]);

  const installationTotals = useMemo(() => {
    const workers = parseNumeric(installationInputs.workers);
    const engineers = parseNumeric(installationInputs.engineers);
    const supervisors = parseNumeric(installationInputs.supervisors);
    const totalWorkers = workers + engineers + supervisors;

    const monthlyRiyadh = 3800 * workers + 15750 * engineers + 9000 * supervisors + 2000;
    const monthlyRemote = 5850 * workers + 14600 * engineers + 8600 * supervisors + 4000;

    const weeklyRiyadh = monthlyRiyadh / 4;
    const weeklyRemote = monthlyRemote / 4;

    const projectPeriod =
      workers > 0
        ? (totalManhour / workers / 8 / 6) * 1.2
        : 0;

    const manpowerRiyadh = weeklyRiyadh * projectPeriod;
    const manpowerRemote = weeklyRemote * projectPeriod;

    const profitRiyadh = manpowerRiyadh * 0.4;
    const profitRemote = manpowerRemote * 0.4;

    const riskRiyadh = manpowerRiyadh * 0.15;
    const riskRemote = manpowerRemote * 0.15;

    const priceRiyadh = manpowerRiyadh + profitRiyadh + riskRiyadh;
    const priceRemote = manpowerRemote + profitRemote + riskRemote;

    return {
      workers,
      engineers,
      supervisors,
      totalWorkers,
      monthlyRiyadh,
      monthlyRemote,
      weeklyRiyadh,
      weeklyRemote,
      projectPeriod,
      manpowerRiyadh,
      manpowerRemote,
      profitRiyadh,
      profitRemote,
      riskRiyadh,
      riskRemote,
      priceRiyadh,
      priceRemote,
    };
  }, [installationInputs, totalManhour]);
  const isRemoteLocation = installationInputs.location === "remote";
  const installationUnitPriceNumber = isRemoteLocation ? installationTotals.priceRemote : installationTotals.priceRiyadh;
  const installationFieldStyle: React.CSSProperties = {
    flex: "1 1 200px",
    minWidth: "180px",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  };

  const pricingTotalsSum = useMemo(() => {
    const itemsTotal = pricingSelections.reduce((sum, entry) => {
      const computedTotal = computeTotalPrice(entry.item.unit_price, entry.item.quantity);
      const totalPrice = entry.item.total_price ?? computedTotal;
      return sum + parseNumeric(totalPrice);
    }, 0);
    const electricalTotal = parseNumeric(
      electricalRow.totalPrice || computeTotalPrice(electricalRow.unitPrice, electricalRow.qty)
    );
    const atgTotal = parseNumeric(atgRow.totalPrice || computeTotalPrice(atgRow.unitPrice, atgRow.qty));
    const installationTotal = parseNumeric(computeTotalPrice(installationUnitPriceNumber, "1"));
    return itemsTotal + electricalTotal + atgTotal + installationTotal;
  }, [
    pricingSelections,
    electricalRow.totalPrice,
    electricalRow.unitPrice,
    electricalRow.qty,
    atgRow.totalPrice,
    atgRow.unitPrice,
    atgRow.qty,
    installationUnitPriceNumber,
  ]);

  const minSellingPriceNumber = parseNumeric(minSellingPrice);
  const minSellingPriceColor =
    minSellingPrice.trim() === ""
      ? undefined
      : pricingTotalsSum >= minSellingPriceNumber
        ? "#1b9e3e"
        : "#d93025";

  const estimateTableRows = useMemo(() => {
    const rows: Array<{
      description?: string;
      capacity?: string;
      size?: string;
      quantity?: string;
      unit?: string;
      remarks?: string;
      unitPrice?: string;
      totalPrice?: string;
    }> = [];

    const normalizeValue = (value: string | number | undefined) => {
      if (value === undefined || value === null) return "";
      return typeof value === "number" ? value.toString() : value;
    };

    pricingSelections.forEach((sel) => {
      rows.push({
        description: sel.item.description || sel.item.full_description || sel.item.item_type,
        capacity: normalizeValue(sel.item.capacity),
        size: normalizeValue(sel.item.size),
        quantity: normalizeValue(sel.item.quantity),
        unit: normalizeValue(sel.item.unit),
        remarks: normalizeValue(sel.item.remarks),
        unitPrice: normalizeValue(sel.item.unit_price),
        totalPrice: normalizeValue(sel.item.total_price),
      });
    });

    const electricalAmount = parseNumeric(electricalRow.totalPrice || electricalRow.unitPrice);
    if (electricalAmount > 0) {
      rows.push({
        description: electricalRow.description,
        capacity: "",
        size: "",
        quantity: electricalRow.qty,
        unit: electricalRow.unit,
        remarks: "",
        unitPrice: electricalRow.unitPrice,
        totalPrice: electricalRow.totalPrice,
      });
    }

    const atgAmount = parseNumeric(atgRow.totalPrice || atgRow.unitPrice);
    if (atgAmount > 0) {
      rows.push({
        description: atgRow.description,
        capacity: "",
        size: "",
        quantity: atgRow.qty,
        unit: atgRow.unit,
        remarks: "",
        unitPrice: atgRow.unitPrice,
        totalPrice: atgRow.totalPrice,
      });
    }

    const installationUnitPrice = Number.isFinite(installationUnitPriceNumber)
      ? Number(installationUnitPriceNumber).toFixed(2)
      : "";
    const installationTotalPrice = computeTotalPrice(installationUnitPriceNumber, "1");
    const installationAmount = parseNumeric(installationTotalPrice || installationUnitPrice);

    if (installationAmount > 0) {
      rows.push({
        description: "Installation, T&C",
        capacity: "",
        size: "",
        quantity: "1",
        unit: "Lot",
        remarks: "",
        unitPrice: installationUnitPrice,
        totalPrice: installationTotalPrice,
      });
    }

    return rows.filter((row) =>
      Object.values(row).some((value) => (value ?? "").toString().trim().length > 0)
    );
  }, [pricingSelections, electricalRow, atgRow, installationUnitPriceNumber]);

  const estimateTotals = useMemo(() => {
    const subtotal = estimateTableRows.reduce((sum, row) => {
      return sum + parseNumeric(row.totalPrice);
    }, 0);
    const discountPct = Math.max(0, parseNumeric(estimateDiscountPct));
    const discount = subtotal * (discountPct / 100);
    const afterDiscount = subtotal - discount;
    const vat = afterDiscount * 0.15;
    const totalWithVat = afterDiscount + vat;
    return {
      subtotal,
      discountPct,
      discount,
      afterDiscount,
      vat,
      totalWithVat,
    };
  }, [estimateTableRows, estimateDiscountPct]);

  const estimateInputStyle: React.CSSProperties = { height: "2.6rem" };
  const estimateInputPaddedStyle: React.CSSProperties = { ...estimateInputStyle, padding: "0.6rem 0.9rem" };

  const fetchLogoDataUrl = useCallback(async (): Promise<string> => {
    const candidates = [
      COMPANY_LOGO_URL,
      `${window.location.origin}${COMPANY_LOGO_URL}`,
      "/data/company.png",
      `${window.location.origin}/data/company.png`,
      "/company.png",
      `${window.location.origin}/company.png`,
    ];
    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.size) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      } catch {
        continue;
      }
    }
    return "";
  }, []);

  const handleGenerateEstimatePdf = useCallback(async () => {
    const quotationDate = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(quotationDate.getDate() + 30);

    const formatDate = (date: Date) =>
      date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    const tableRowsHtml = estimateTableRows
      .map((row, idx) => {
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${row.description || "—"}</td>
            <td>${row.capacity || "—"}</td>
            <td>${row.size || "—"}</td>
            <td>${row.quantity || "—"}</td>
            <td>${row.unit || "—"}</td>
            <td>${row.remarks || "—"}</td>
            <td>${row.unitPrice || "—"}</td>
            <td>${row.totalPrice || "—"}</td>
          </tr>
        `;
      })
      .join("");

    const summaryRowsHtml = `
      <tr class="summary-row">
        <td></td>
        <td class="summary-label">Untaxed Amount</td>
        <td colspan="5"></td>
        <td></td>
        <td class="summary-value"><strong>${formatNumber(estimateTotals.afterDiscount)}</strong></td>
      </tr>
      <tr class="summary-row">
        <td></td>
        <td class="summary-label">Tax 15%</td>
        <td colspan="5"></td>
        <td></td>
        <td class="summary-value"><strong>${formatNumber(estimateTotals.vat)}</strong></td>
      </tr>
      <tr class="summary-row">
        <td></td>
        <td class="summary-label">Total</td>
        <td colspan="5"></td>
        <td></td>
        <td class="summary-value"><strong>${formatNumber(estimateTotals.totalWithVat)}</strong></td>
      </tr>
    `;

    const companyNameForPrint = estimateCompanyName || COMPANY_NAME;
    const contactNameForPrint = estimateContactName || CONTACT_NAME;
    const printableHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Estimate</title>
          <style>
            @page {
              size: A4;
              margin: 12mm;
            }
            * { box-sizing: border-box; }
            body {
              margin: 12mm;
              font-family: "Segoe UI", Tahoma, sans-serif;
              color: #222;
            }
            .logo-banner {
              display: flex;
              justify-content: flex-start;
              align-items: center;
              margin-bottom: 8px;
            }
            .logo-banner img {
              height: 100px;
              object-fit: contain;
              display: block;
            }
            .logo-separator {
              border-bottom: 2px solid #b10d27;
              margin: 8px 0 12px 0;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 16px;
              border-bottom: 2px solid #b10d27;
              padding-bottom: 12px;
            }
            .company-block {
              display: flex;
              gap: 12px;
              align-items: center;
            }
            .company-logo img {
              height: 60px;
              object-fit: contain;
            }
            .company-details {
              font-size: 12px;
              line-height: 1.4;
            }
            .quote-title {
              font-size: 24px;
              font-weight: 700;
              margin: 16px 0 6px 0;
              color: #000;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
              gap: 8px 16px;
              margin-bottom: 16px;
              font-size: 12px;
            }
            .meta-grid strong {
              display: inline-block;
              min-width: 110px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
            }
            thead th {
              text-align: left;
              border-bottom: 2px solid #b10d27;
              padding: 6px 5px;
              font-weight: 700;
              font-size: 11px;
            }
            tbody td {
              border-bottom: 1px solid #e4e7eb;
              padding: 5px;
              vertical-align: top;
            }
            tfoot td {
              padding: 5px;
            }
            .summary-row td {
              border-top: 1px solid #d7dce4;
            }
            .summary-label {
              font-weight: 600;
            }
            .summary-value {
              text-align: right;
            }
            .notes {
              margin-top: 18px;
              font-size: 11px;
              line-height: 1.45;
            }
            .right {
              text-align: right;
            }
            @media print {
              body { margin: 12mm; }
              .no-print { display: none; }
              thead { display: table-header-group; }
              tfoot { display: table-row-group; }
              tr { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="logo-banner">
            <img src="__LOGO_SRC__" alt="Company Logo" />
          </div>
          <div class="header">
            <div class="company-details">
              <div>${companyNameForPrint}</div>
              <div>Integrated Engineering Contracting Co.</div>
            </div>
            <div class="company-details">
              <div><strong>Company Name:</strong> ${companyNameForPrint}</div>
              <div><strong>Contact Name:</strong> ${contactNameForPrint}</div>
              <div><strong>Project Name:</strong> ${estimateProjectName || "—"}</div>
              <div><strong>Subject:</strong> ${estimateSubject || "—"}</div>
            </div>
          </div>

          <div class="quote-title">Quotation #110000027</div>

          <div class="meta-grid">
            <div><strong>Quotation Date:</strong> ${formatDate(quotationDate)}</div>
            <div><strong>Expiration:</strong> ${formatDate(expirationDate)}</div>
            <div><strong>Salesperson:</strong> —</div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 36px;">S.N</th>
                <th style="min-width: 220px;">Description</th>
                <th style="width: 70px;">Capacity</th>
                <th style="width: 70px;">Size</th>
                <th style="width: 55px;">Quantity</th>
                <th style="width: 50px;">Unit</th>
                <th style="width: 110px;">Remarks</th>
                <th style="width: 80px;">Unit Price</th>
                <th style="width: 100px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
            <tfoot>
              ${summaryRowsHtml}
            </tfoot>
          </table>

          <div class="notes">
            <p><strong>Payment terms:</strong> 100% advance payment</p>
            <p><strong>Delivery Terms:</strong> DDP</p>
            <p><strong>Delivery Period:</strong> TBD</p>
            <p><strong>Scope of Work:</strong> Supply only</p>
            <p><strong>Important Notes:</strong> Prices are based on complete system supply under one PO. Partial orders or quantity changes may cause price revisions.</p>
          </div>
        </body>
      </html>
    `;

    const logoDataUrl = await fetchLogoDataUrl();
    const logoUrlForPrint =
      logoDataUrl || `${window.location.origin}${COMPANY_LOGO_URL}`;

    const waitForImages = (doc: Document, timeoutMs = 2500) =>
      new Promise<void>((resolve) => {
        try {
          const images = Array.from(doc.images || []);
          if (!images.length) return resolve();
          let loaded = 0;
          const done = () => {
            loaded += 1;
            if (loaded >= images.length) resolve();
          };
          images.forEach((img) => {
            if (img.complete) {
              done();
            } else {
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
            }
          });
          setTimeout(() => resolve(), timeoutMs);
        } catch {
          resolve();
        }
      });

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-modals");
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc) return;
    frameDoc.open();
    frameDoc.write(printableHtml.replace(/__LOGO_SRC__/g, logoUrlForPrint));
    frameDoc.close();

    await waitForImages(frameDoc);

    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    setTimeout(() => {
      iframe.remove();
    }, 1000);
  }, [
    estimateTableRows,
    estimateTotals.subtotal,
    estimateTotals.totalWithVat,
    estimateTotals.vat,
    estimateProjectName,
    estimateSubject,
  ]);

  const pickFieldFromRow = (
    row: Record<string, string | number> | undefined,
    patterns: RegExp[]
  ): string | undefined => {
    if (!row) return undefined;
    for (const [key, value] of Object.entries(row)) {
      if (patterns.some((re) => re.test(key))) {
        return typeof value === "number" ? value.toString() : String(value);
      }
    }
    return undefined;
  };

  const runPriceMapping = async (selections: Array<{ source: ItemSource; item: ExtractedItem }>) => {
    if (!selections.length) return;
    setPricingLoading(true);
    setPricingStatus("Matching items to price list with AI…");
    try {
      const resp = await priceMap(selections.map(s => s.item));
      console.log("priceMap response", resp);
      setPricingStatus("Applying matched prices and manhours…");
      if (resp?.mappings?.length) {
        const grouped = resp.mappings.reduce<Record<number, PriceMapping[]>>((acc, mapping) => {
          if (mapping.item_index === undefined || mapping.item_index === null) return acc;
          if (!acc[mapping.item_index]) acc[mapping.item_index] = [];
          const exists = acc[mapping.item_index].some(
            (m) => m.price_list_index === mapping.price_list_index
          );
          if (!exists) {
            acc[mapping.item_index].push(mapping);
          }
          return acc;
        }, {});
        setPricingMatchOptions(grouped);
        const defaultChoices: Record<number, number> = {};
        Object.keys(grouped).forEach((key) => {
          defaultChoices[Number(key)] = 0;
        });
        setPricingMatchChoice(defaultChoices);
        setPricingSelections(prev => {
          return prev.map((entry, idx) => {
            const match = grouped[idx]?.[0];
            if (!match) return entry;
            const row = match.price_row as Record<string, string | number> | undefined;
            const rowPrice = pickFieldFromRow(row, [/price/i]);
            const rowMh = pickFieldFromRow(row, [/manhour/i, /mh/i]);
            const nextUnitPriceRaw =
              match.unit_price !== undefined ? String(match.unit_price) : rowPrice ?? entry.item.unit_price;
            const nextUnitPrice = roundPrice(nextUnitPriceRaw);
            const nextUnitMh =
              match.unit_manhour !== undefined ? String(match.unit_manhour) : rowMh ?? entry.item.unit_manhour;
            return {
              ...entry,
              item: {
                ...entry.item,
                unit_price: nextUnitPrice,
                unit_manhour: nextUnitMh,
                total_price: computeTotalPrice(nextUnitPrice, entry.item.quantity),
                total_manhour: computeTotalValue(nextUnitMh, entry.item.quantity),
              },
            };
          });
        });
        setPricingStatus("Pricing data filled for matched items.");
      } else {
        setPricingStatus("No price list matches returned.");
      }
    } catch (error) {
      console.error("price map failed", error);
      setFeedback((error as Error).message || "Failed to map prices.");
      setTimeout(() => setFeedback(""), 3500);
    } finally {
      setTimeout(() => setPricingStatus(""), 2000);
      setPricingLoading(false);
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

  const handleGoToPricing = () => {
    if (finalizeItems.length === 0) {
      setFeedback("Add items before going to pricing.");
      setTimeout(() => setFeedback(""), 2500);
      return;
    }
    const nextSelections = finalizeItems.map((entry) => ({ item: entry.item, source: entry.source }));
    setPricingSelections(nextSelections);
    setActiveEstimateStep("pricing");
    void runPriceMapping(nextSelections);
  };

  const handlePricingItemChange = (idx: number, field: keyof ExtractedItem, value: string) => {
    setPricingSelections(prev => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const nextValue = field === "unit_price" ? roundPrice(value) : value;
      const updatedItem = { ...next[idx].item, [field]: nextValue };
      if (field === "unit_price" || field === "quantity") {
        updatedItem.total_price = computeTotalPrice(updatedItem.unit_price, updatedItem.quantity);
      }
      if (field === "unit_manhour" || field === "quantity") {
        updatedItem.total_manhour = computeTotalValue(updatedItem.unit_manhour, updatedItem.quantity);
      }
      next[idx] = { ...next[idx], item: updatedItem };
      return next;
    });
  };

  const handleInstallationChange = (field: keyof InstallationInputs, value: string) => {
    setInstallationInputs(prev => ({
      ...prev,
      [field]: field === "location" ? (value as InstallationLocation) : value,
    }));
  };

  const normaliseNumericValue = (value: number | string | undefined) => {
    if (value === undefined || value === null) return "";
    return typeof value === "number" ? value.toString() : String(value);
  };

  const handleFetchAtgData = async () => {
    setAtgLoading(true);
    setAtgError("");
    try {
      const data: AtgTotals = await fetchAtgTotals();
      const unitPrice = roundPrice(normaliseNumericValue(data.totalSellingPrice));
      const unitManhour = normaliseNumericValue(data.totalManhour);
      setAtgRow(prev => {
        const qty = prev.qty || "1";
        return {
          description: "ATG System",
          unit: "Lot",
          qty,
          unitPrice,
          totalPrice: computeTotalPrice(unitPrice, qty),
          unitManhour,
          totalManhour: computeTotalValue(unitManhour, qty),
        };
      });
    } catch (error) {
      console.error("Failed to load ATG data", error);
      setAtgError((error as Error).message || "Failed to load ATG data.");
    } finally {
      setAtgLoading(false);
    }
  };

  const handleAtgQtyChange = (value: string) => {
    setAtgRow(prev => {
      const qty = value;
      return {
        ...prev,
        qty,
        totalPrice: computeTotalPrice(prev.unitPrice, qty),
        totalManhour: computeTotalValue(prev.unitManhour, qty),
      };
    });
  };

  const handleFetchElectricalData = async () => {
    setElectricalLoading(true);
    setElectricalError("");
    try {
      const payload: ElectricalCalcRequest = {
        a2: Number(electricalInputs["a2"] ?? 0) || 0,
        x: Number(electricalInputs["x"] ?? 0) || 0,
        y: Number(electricalInputs["y"] ?? 0) || 0,
        z: Number(electricalInputs["z"] ?? 0) || 0,
        cValues: Array.from({ length: 21 }).map((_, idx) => {
          const key = `c${5 + idx}`;
          const val = Number(electricalInputs[key] ?? 0);
          return Number.isFinite(val) ? val : 0;
        }),
      };
      const data = await calculateElectrical(payload);
      const unitPrice = roundPrice(normaliseNumericValue(data.totalPrice));
      const unitManhour = normaliseNumericValue(data.totalManhours);
      setElectricalRow(prev => {
        const qty = prev.qty || "1";
        return {
          description: "Electrical System",
          unit: "Lot",
          qty,
          unitPrice,
          totalPrice: computeTotalPrice(unitPrice, qty),
          unitManhour,
          totalManhour: computeTotalValue(unitManhour, qty),
        };
      });
      setElectricalModalOpen(false);
    } catch (error) {
      console.error("Failed to load Electrical data", error);
      setElectricalError((error as Error).message || "Failed to load Electrical data.");
    } finally {
      setElectricalLoading(false);
    }
  };

  const handleElectricalQtyChange = (value: string) => {
    setElectricalRow(prev => {
      const qty = value;
      return {
        ...prev,
        qty,
        totalPrice: computeTotalPrice(prev.unitPrice, qty),
        totalManhour: computeTotalValue(prev.unitManhour, qty),
      };
    });
  };

  const handlePriceListSearchChange = (rowIdx: number, query: string) => {
    setPriceListSearch(prev => ({ ...prev, [rowIdx]: query }));
  };

  const handleApplyPriceListRow = (rowIdx: number, priceListIndex: number) => {
    const row = priceList[priceListIndex];
    if (!row) return;
    const mapping: PriceMapping = {
      item_index: rowIdx,
      price_list_index: priceListIndex,
      price_row: row,
    };
    let nextChoice = 0;
    setPricingMatchOptions(prev => {
      const existing = prev[rowIdx] || [];
      const foundIdx = existing.findIndex(m => m.price_list_index === priceListIndex);
      if (foundIdx >= 0) {
        nextChoice = foundIdx;
        return prev;
      }
      nextChoice = existing.length;
      return { ...prev, [rowIdx]: [...existing, mapping] };
    });
    setPricingMatchChoice(prev => ({ ...prev, [rowIdx]: nextChoice }));
    applyPriceMappingToRow(rowIdx, mapping);
    setPriceListSearch(prev => ({ ...prev, [rowIdx]: "" }));
    setPricingDropdownOpen((prev) => ({ ...prev, [rowIdx]: false }));
  };

  const handlePricingMatchChange = (rowIdx: number, optionIdx: number) => {
    const options = pricingMatchOptions[rowIdx];
    if (!options || !options[optionIdx]) return;
    setPricingMatchChoice((prev) => ({ ...prev, [rowIdx]: optionIdx }));
    const match = options[optionIdx];
    applyPriceMappingToRow(rowIdx, match);
  };

  const handleProceedFromReview = async () => {
    const drawingSelection = hasDrawingData ? getSelectedDrawingItems() : [];
    const boqSelection = hasBoqData ? getSelectedBoqItems() : [];

    if (hasDrawingData && hasBoqData) {
      await handleRunCompare(drawingSelection, boqSelection);
      return;
    }
    const sourceItems = hasDrawingData ? drawingSelection : boqSelection;
    const source: ItemSource = hasDrawingData ? "drawing" : "boq";
    setFinalizeItems(sourceItems.map(item => buildFinalizeEntry(item, source)));
    setActiveEstimateStep("finalize");
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (electricalModalOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => document.body.classList.remove("modal-open");
  }, [electricalModalOpen]);

  const handleRunCompare = async (drawingItemsParam?: ExtractedItem[], boqItemsParam?: ExtractedItem[]) => {
    const drawingItems = drawingItemsParam ?? getSelectedDrawingItems();
    const boqItems = boqItemsParam ?? getSelectedBoqItems();
    if (!drawingItems.length || !boqItems.length) return;
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
      const compareResp = await compareLists(drawingItems, boqItems);
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

        {electricalModalOpen && (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: "900px", width: "90vw" }}>
              <div className="modal__header">
                <h3 className="modal__title">Electrical Variables</h3>
                <button
                  type="button"
                  className="modal__close"
                  aria-label="Close"
                  onClick={() => setElectricalModalOpen(false)}
                  disabled={electricalLoading}
                >
                  ×
                </button>
              </div>
              <div className="modal__body">
                <div className="electrical-inputs-grid">
                  {ELECTRICAL_INPUT_DEFAULTS
                    .filter(item => item.key !== "a2")
                    .map((item) => (
                      <label key={item.key} className="electrical-input">
                        <span className="electrical-input__label">{item.label}</span>
                        <input
                          className="form-input electrical-input__control"
                          type="number"
                          step="1"
                          value={electricalInputs[item.key] ?? ""}
                          onChange={(e) =>
                            setElectricalInputs(prev => ({
                              ...prev,
                              [item.key]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                </div>
                {electricalError && (
                  <div className="modal__error">{electricalError}</div>
                )}
              </div>
              <div className="modal__footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleFetchElectricalData}
                  disabled={electricalLoading}
                >
                  {electricalLoading ? "Calculating…" : "Calculate"}
                </button>
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
        {pricingLoading && (
          <div className="processing-overlay" style={{ zIndex: 3600 }}>
            <div className="processing-indicator">
              <div className="processing-indicator__spinner">
                <svg width="40" height="40" viewBox="0 0 40 40" className="spinner">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="80" strokeDashoffset="20" strokeLinecap="round" />
                </svg>
              </div>
              <div className="processing-indicator__text">
                <p className="processing-indicator__message">{pricingStatus || "Getting pricing from AI…"}</p>
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
                  disabled={boqCompareLoading || boqEnrichLoading}
                >
                  {boqEnrichLoading
                    ? "Completing BOQ…"
                    : hasDrawingData && hasBoqData
                      ? "Compare"
                      : "Finalize items"}
                </button>
              </div>
            </div>
            <div className="review-grid">
              {hasDrawingData && (
                <div className="review-block">
                  <p className="eyebrow">Extracted Items from Drawings</p>
                  <div className="table-toolbar">
                    <span className="table-count">Selected {drawingSelectedCount} / {filteredDrawingReviewRows.length}</span>
                    <div className="table-toolbar__actions" style={{ gap: "0.5rem" }}>
                      <input
                        className="form-input form-input--table"
                        placeholder="Search description…"
                        value={drawingSearch}
                        onChange={(e) => setDrawingSearch(e.target.value)}
                        style={{ width: "240px" }}
                      />
                      <button type="button" className="btn-ghost" onClick={() => setAllDrawingSelection(true)}>Check all</button>
                      <button type="button" className="btn-ghost" onClick={() => setAllDrawingSelection(false)}>Uncheck all</button>
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="matches-table resizable-table">
                      <thead>
                        <tr>
                          <th className="checkbox-col"></th>
                          <th>Description</th>
                          <th>Capacity</th>
                          <th>Size</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDrawingReviewRows.length ? (
                          filteredDrawingReviewRows.map(({ item, fileIdx, itemIdx, key }) => {
                            const isSelected = !!selectedDrawingRows[key];
                            const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
                              const target = event.target as HTMLElement;
                              if (target.closest("input, textarea, button, select")) return;
                              setSelectedDrawingRows(prev => ({ ...prev, [key]: !prev[key] }));
                            };
                            return (
                              <tr
                                key={key}
                                className={`matches-table__row ${isSelected ? "is-selected" : ""}`}
                                onClick={handleRowClick}
                              >
                                <td className="checkbox-col">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const checked = e.target.checked;
                                      setSelectedDrawingRows(prev => ({ ...prev, [key]: checked }));
                                    }}
                                  />
                                </td>
                                <td className="finalize-col finalize-col--description">
                                  <textarea
                                    className="form-input form-input--table finalize-textarea"
                                    value={item.description || item.full_description || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateDrawingItemField(fileIdx, itemIdx, "description", e.target.value);
                                    }}
                                    placeholder="Description"
                                    rows={1}
                                  />
                                </td>
                                <td className="finalize-col finalize-col--capacity">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.capacity || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateDrawingItemField(fileIdx, itemIdx, "capacity", e.target.value);
                                    }}
                                    placeholder="Capacity"
                                  />
                                </td>
                                <td className="finalize-col finalize-col--size">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.size || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateDrawingItemField(fileIdx, itemIdx, "size", e.target.value);
                                    }}
                                    placeholder="Size"
                                  />
                                </td>
                                <td className="finalize-col finalize-col--qty">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.quantity || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateDrawingItemField(fileIdx, itemIdx, "quantity", e.target.value);
                                    }}
                                    placeholder="Qty"
                                  />
                                </td>
                                <td className="finalize-col finalize-col--unit">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.unit || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateDrawingItemField(fileIdx, itemIdx, "unit", e.target.value);
                                    }}
                                    placeholder="Unit"
                                  />
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", color: "rgba(227,233,255,0.7)" }}>
                              No drawing items match this description search.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {hasBoqData && (
                <div className="review-block">
                  <p className="eyebrow">Extracted BOQ Items</p>
                  <div className="table-toolbar">
                    <span className="table-count">Selected {boqSelectedCount} / {filteredBoqReviewRows.length}</span>
                    <div className="table-toolbar__actions" style={{ gap: "0.5rem" }}>
                      <input
                        className="form-input form-input--table"
                        placeholder="Search description…"
                        value={boqSearch}
                        onChange={(e) => setBoqSearch(e.target.value)}
                        style={{ width: "240px" }}
                      />
                      <button type="button" className="btn-ghost" onClick={() => setAllBoqSelection(true)}>Check all</button>
                      <button type="button" className="btn-ghost" onClick={() => setAllBoqSelection(false)}>Uncheck all</button>
                    </div>
                  </div>
                  <div className="table-wrapper table-wrapper--no-x">
                    <table className="matches-table resizable-table">
                      <thead>
                        <tr>
                          <th className="checkbox-col"></th>
                          <th className="boq-col-description">Description</th>
                          <th className="boq-col-capacity">Capacity</th>
                          <th className="boq-col-size">Size</th>
                          <th className="boq-col-qty">Quantity</th>
                          <th className="boq-col-unit">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBoqReviewRows.length ? (
                          filteredBoqReviewRows.map(({ item, itemIdx, key }) => {
                            const isSelected = !!selectedBoqRows[key];
                            const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
                              const target = event.target as HTMLElement;
                              if (target.closest("input, textarea, button, select")) return;
                              setSelectedBoqRows(prev => ({ ...prev, [key]: !prev[key] }));
                            };
                            return (
                              <tr
                                key={key}
                                className={`matches-table__row ${isSelected ? "is-selected" : ""}`}
                                onClick={handleRowClick}
                              >
                                <td className="checkbox-col">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const checked = e.target.checked;
                                      setSelectedBoqRows(prev => ({ ...prev, [key]: checked }));
                                    }}
                                  />
                                </td>
                                <td className="boq-col-description">
                                  <textarea
                                    className="form-input form-input--table finalize-textarea"
                                    value={item.description || item.full_description || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateBoqItemField(itemIdx, "description", e.target.value);
                                    }}
                                    placeholder="Description"
                                    rows={1}
                                  />
                                </td>
                                <td className="boq-col-capacity">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.capacity || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateBoqItemField(itemIdx, "capacity", e.target.value);
                                    }}
                                    placeholder="Capacity"
                                  />
                                </td>
                                <td className="boq-col-size">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.size || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateBoqItemField(itemIdx, "size", e.target.value);
                                    }}
                                    placeholder="Size"
                                  />
                                </td>
                                <td>
                                  <input
                                    className="form-input form-input--table"
                                    value={item.quantity || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateBoqItemField(itemIdx, "quantity", e.target.value);
                                    }}
                                    placeholder="Qty"
                                  />
                                </td>
                                <td className="boq-col-unit">
                                  <input
                                    className="form-input form-input--table"
                                    value={item.unit || ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateBoqItemField(itemIdx, "unit", e.target.value);
                                    }}
                                    placeholder="Unit"
                                  />
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", color: "rgba(227,233,255,0.7)" }}>
                              No BOQ items match this description search.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
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
                  <table className="matches-table resizable-table compare-table">
                    <thead>
                      <tr>
                        <th />
                        <ResizableTh resize={comparisonResize} index={0}>BOQ item</ResizableTh>
                        <ResizableTh resize={comparisonResize} index={1}>Drawing item</ResizableTh>
                        <ResizableTh resize={comparisonResize} index={2} className="compare-action-col">Action</ResizableTh>
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
                            className={`selectable-cell ${row.boq_item ? "is-clickable" : "is-disabled"} ${comparisonSelections[idx] === "boq" ? "is-selected" : ""
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
                            className={`selectable-cell ${row.drawing_item ? "is-clickable" : "is-disabled"} ${comparisonSelections[idx] === "drawing" ? "is-selected" : ""
                              }`}
                            onClick={() => handleComparisonCellSelect(idx, "drawing", !!row.drawing_item)}
                          >
                            {renderCell(
                              row.drawing_item
                                ? `${row.drawing_item.description || "—"} (${row.drawing_item.quantity || "?"} ${row.drawing_item.unit || ""}${row.drawing_item.size ? `, ${row.drawing_item.size}` : ""})`
                                : "—"
                            )}
                          </td>
                          <td className="compare-action-col">
                            <select
                              className="form-input form-input--table"
                              value={comparisonSelections[idx] || ""}
                              onChange={(e) => handleComparisonSelect(idx, e.target.value as "drawing" | "boq")}
                            >
                              <option value="">Choose source</option>
                              {row.boq_item && <option value="boq">Select from BOQ</option>}
                              {row.drawing_item && <option value="drawing">Select from Drawings</option>}
                            </select>
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
                        const chosen = comparisonSelections[idx];
                        if (chosen === "boq" && row.boq_item) {
                          selections.push(buildFinalizeEntry(row.boq_item, "boq", row.drawing_item || undefined));
                          return;
                        }
                        if (chosen === "drawing" && row.drawing_item) {
                          selections.push(buildFinalizeEntry(row.drawing_item, "drawing", row.boq_item || undefined));
                          return;
                        }

                        // Fallbacks when no selection provided
                        if (row.status === "match_exact") {
                          if (row.boq_item) {
                            selections.push(buildFinalizeEntry(row.boq_item, "boq", row.drawing_item || undefined));
                            return;
                          }
                          if (row.drawing_item) {
                            selections.push(buildFinalizeEntry(row.drawing_item, "drawing", row.boq_item || undefined));
                            return;
                          }
                        }

                        missingSource = true;
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
              searchQuery={finalizeSearch}
              onSearchChange={setFinalizeSearch}
            />
            <div className="table-actions" style={{ justifyContent: "space-between", gap: "0.75rem" }}>
              <button type="button" className="btn-secondary" onClick={() => setFinalizeItems(prev => [...prev, { item: {}, source: "manual" }])}>
                + Add row
              </button>
              <button type="button" className="btn-match btn-outline" onClick={handleGoToPricing}>
                Go to Pricing
              </button>
            </div>
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "pricing" && (
          <section id="pricing" className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Pricing</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <label htmlFor="minSellingPrice" style={{ fontWeight: 600 }}>
                  Min Selling Price
                </label>
                <input
                  id="minSellingPrice"
                  type="number"
                  className="form-input"
                  value={minSellingPrice}
                  onChange={(e) => setMinSellingPrice(e.target.value)}
                  style={{
                    width: "10rem",
                    height: "2.4rem",
                    color: minSellingPriceColor,
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>
            <div className="pricing-accordion">
              {PRICING_SECTIONS.map(section => {
                const isOpen = activePricingSection === section.id;
                return (
                  <div key={section.id} className={`pricing-accordion__card ${isOpen ? "is-open" : ""}`}>
                    <button
                      type="button"
                      className="pricing-accordion__header"
                      onClick={() => setActivePricingSection(isOpen ? null : section.id)}
                      aria-pressed={isOpen}
                    >
                      <span className="pricing-accordion__label">{section.label}</span>
                      <span className={`pricing-accordion__chevron ${isOpen ? "is-open" : ""}`} aria-hidden="true">▾</span>
                    </button>

                    {isOpen && (
                      <div className="pricing-accordion__panel">
                        {section.id === "items" ? (
                          pricingSelections.length === 0 ? (
                            <p className="empty-state" style={{ margin: 0 }}>No items available for pricing yet.</p>
                          ) : (
                            <>
                              <div className="table-toolbar" style={{ justifyContent: "flex-end", margin: "0.25rem 0 0.5rem" }}>
                                <input
                                  className="form-input form-input--table"
                                  placeholder="Search description…"
                                  value={pricingSearch}
                                  onChange={(e) => setPricingSearch(e.target.value)}
                                  style={{ width: "260px" }}
                                />
                              </div>
                              <div className="table-wrapper table-wrapper--no-x pricing-table-wrapper" style={{ marginTop: "0.5rem" }}>
                                <table className="matches-table resizable-table pricing-table">
                                  <thead>
                                    <tr>
                                      <ResizableTh resize={pricingResize} index={0}>Id</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={1}>Item</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={2}>Description</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={3}>Capacity</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={4}>Size</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={5}>QTY</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={6}>Unit</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={7}>Remarks</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={8}>Unit Price</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={9}>Total Price</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={10}>Unit Manhour</ResizableTh>
                                      <ResizableTh resize={pricingResize} index={11}>Total Manhour</ResizableTh>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredPricingSelections.length ? (
                                      filteredPricingSelections.map(({ sel, idx }) => {
                                        const rowIdx = idx;
                                        const matchOptions = pricingMatchOptions[rowIdx] || [];
                                        return (
                                          <tr key={`pricing-${rowIdx}`} className="matches-table__row">
                                            <td>{rowIdx + 1}</td>
                                            <td>
                                              {renderCell(sel.item.item_type)}
                                            </td>
                                            <td>
                                              <div
                                                className="pricing-desc-cell"
                                                ref={(node) => {
                                                  pricingDropdownRefs.current[rowIdx] = node;
                                                }}
                                                onBlurCapture={(e) => {
                                                  const nextTarget = e.relatedTarget as Node | null;
                                                  if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
                                                    closeMatchDropdown(rowIdx);
                                                  }
                                                }}
                                                onMouseLeave={() => closeMatchDropdown(rowIdx)}
                                              >
                                                <span className="pricing-desc-text">
                                                  {renderCell(sel.item.description || sel.item.full_description)}
                                                </span>
                                                <>
                                                  <button
                                                    type="button"
                                                    className="pricing-match-trigger"
                                                    aria-label="Select pricing option"
                                                    aria-expanded={pricingDropdownOpen[rowIdx] || false}
                                                    ref={(node) => {
                                                      pricingTriggerRefs.current[rowIdx] = node;
                                                    }}
                                                    onClick={() => openMatchDropdown(rowIdx)}
                                                  >
                                                    ▾
                                                  </button>
                                                  {pricingDropdownOpen[rowIdx] && (
                                                    <div
                                                      className="pricing-match-menu"
                                                      style={
                                                        pricingDropdownPos[rowIdx]
                                                          ? {
                                                            top: pricingDropdownPos[rowIdx].top,
                                                            left: pricingDropdownPos[rowIdx].left,
                                                            minWidth: Math.max(180, pricingDropdownPos[rowIdx].width + 8),
                                                            fontSize: "0.85rem",
                                                            padding: "0.3rem",
                                                          }
                                                          : undefined
                                                      }
                                                      onMouseLeave={() => closeMatchDropdown(rowIdx)}
                                                    >
                                                      {matchOptions.length > 0 ? (
                                                        matchOptions.map((opt, optIdx) => (
                                                          <button
                                                            key={`${rowIdx}-match-${optIdx}`}
                                                            type="button"
                                                            className={`pricing-match-menu__item ${pricingMatchChoice[rowIdx] === optIdx ? "is-active" : ""
                                                              }`}
                                                            style={{ padding: "0.3rem 0.45rem", fontSize: "0.85rem" }}
                                                            onClick={() => {
                                                              handlePricingMatchChange(rowIdx, optIdx);
                                                              setPricingDropdownOpen((prev) => ({
                                                                ...prev,
                                                                [rowIdx]: false,
                                                              }));
                                                            }}
                                                          >
                                                            {getMatchLabel(opt)}
                                                          </button>
                                                        ))
                                                      ) : (
                                                        <p className="pricing-match-menu__hint">No suggestions yet. Use search below.</p>
                                                      )}
                                                      <div
                                                        className="pricing-match-search"
                                                        style={{
                                                          borderTop: "1px solid #e0e0e0",
                                                          marginTop: "0.4rem",
                                                          paddingTop: "0.4rem",
                                                          display: "flex",
                                                          flexDirection: "column",
                                                          gap: "0.35rem",
                                                        }}
                                                      >
                                                        <input
                                                          id={`pricing-search-${rowIdx}`}
                                                          className="form-input form-input--table"
                                                          type="text"
                                                          placeholder="Search Pricing List…"
                                                          value={priceListSearch[rowIdx] || ""}
                                                          style={{ fontSize: "0.85rem", height: "1.9rem" }}
                                                          onChange={(e) => handlePriceListSearchChange(rowIdx, e.target.value)}
                                                        />
                                                        {(() => {
                                                          const query = priceListSearch[rowIdx] || "";
                                                          const matches = findPriceListMatches(query);
                                                          const canSearch = query.trim().length >= 3;
                                                          if (priceListLoading) {
                                                            return <p className="pricing-match-menu__hint">Loading pricing list…</p>;
                                                          }
                                                          if (priceListError) {
                                                            return <p className="pricing-match-menu__hint" style={{ color: "#c00" }}>{priceListError}</p>;
                                                          }
                                                          if (!canSearch) {
                                                            return <p className="pricing-match-menu__hint">Type at least 3 characters to search</p>;
                                                          }
                                                          if (!matches.length) {
                                                            return <p className="pricing-match-menu__hint">No matches found</p>;
                                                          }
                                                          return (
                                                            <div
                                                              className="pricing-match-search__results"
                                                              style={{
                                                                display: "flex",
                                                                flexDirection: "column",
                                                                gap: "0.25rem",
                                                                maxHeight: "140px",
                                                                overflowY: "auto",
                                                              }}
                                                            >
                                                              {matches.map(({ row: priceRow, rowIndex }) => {
                                                                const label = getPriceListItemLabel(priceRow) || `Item ${rowIndex + 1}`;
                                                                const description =
                                                                  (priceRow["Description"] as string) ||
                                                                  (priceRow["Desc"] as string) ||
                                                                  "";
                                                                return (
                                                                  <button
                                                                    key={`pricing-search-${rowIdx}-${rowIndex}`}
                                                                    type="button"
                                                                    className="pricing-match-menu__item"
                                                                    style={{ padding: "0.3rem 0.45rem", fontSize: "0.85rem" }}
                                                                    onClick={() => handleApplyPriceListRow(rowIdx, rowIndex)}
                                                                  >
                                                                    <span style={{ display: "block", fontWeight: 600 }}>{label}</span>
                                                                    {description && (
                                                                      <span className="pricing-match-menu__note" style={{ display: "block", fontSize: "0.85rem", color: "#444" }}>
                                                                        {description}
                                                                      </span>
                                                                    )}
                                                                  </button>
                                                                );
                                                              })}
                                                            </div>
                                                          );
                                                        })()}
                                                      </div>
                                                    </div>
                                                  )}
                                                </>
                                              </div>
                                            </td>
                                            <td>{renderCell(sel.item.capacity)}</td>
                                            <td>{renderCell(sel.item.size)}</td>
                                            <td>
                                              <input
                                                className="form-input form-input--table"
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={sel.item.quantity || ""}
                                                onChange={(e) => handlePricingItemChange(rowIdx, "quantity", e.target.value)}
                                                placeholder="QTY"
                                              />
                                            </td>
                                            <td>{renderCell(sel.item.unit)}</td>
                                            <td>
                                              {renderCell(sel.item.remarks)}
                                            </td>
                                            <td>
                                              {renderCell(sel.item.unit_price)}
                                            </td>
                                            <td>{renderCell(sel.item.total_price)}</td>
                                            <td>
                                              {renderCell(sel.item.unit_manhour)}
                                            </td>
                                            <td>
                                              {renderCell(sel.item.total_manhour)}
                                            </td>
                                          </tr>
                                        );
                                      })
                                    ) : (
                                      <tr>
                                        <td colSpan={12} style={{ textAlign: "center", color: "rgba(227,233,255,0.7)" }}>
                                          No items match this description search.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )
                        ) : section.id === "electrical" ? (
                          <div className="pricing-electrical">
                            <div className="table-actions" style={{ justifyContent: "flex-start", gap: "0.75rem", marginBottom: "0.75rem" }}>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setElectricalModalOpen(true)}
                              >
                                Calculate Electrical
                              </button>
                            </div>
                            <div className="table-wrapper table-wrapper--no-x pricing-table-wrapper" style={{ marginTop: "0.5rem" }}>
                              <table className="matches-table resizable-table pricing-table">
                                <thead>
                                  <tr>
                                    <ResizableTh resize={pricingResize} index={0}>Item Description</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={1}>Qty</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={2}>Unit</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={3}>Unit Price</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={4}>Total Price</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={5}>Unit Manhour</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={6}>Total Manhour</ResizableTh>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="matches-table__row">
                                    <td>
                                      {renderCell(electricalRow.description)}
                                    </td>
                                    <td>
                                      <input
                                        className="form-input form-input--table"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={electricalRow.qty}
                                        onChange={(e) => handleElectricalQtyChange(e.target.value)}
                                      />
                                    </td>
                                    <td>
                                      {renderCell(electricalRow.unit)}
                                    </td>
                                    <td>
                                      {renderCell(electricalRow.unitPrice)}
                                    </td>
                                    <td>{renderCell(electricalRow.totalPrice)}</td>
                                    <td>
                                      {renderCell(electricalRow.unitManhour)}
                                    </td>
                                    <td>{renderCell(electricalRow.totalManhour)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : section.id === "atg" ? (
                          <div className="pricing-atg">
                            <div className="table-actions" style={{ justifyContent: "flex-start", gap: "0.75rem" }}>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={handleFetchAtgData}
                                disabled={atgLoading}
                              >
                                {atgLoading ? "Loading…" : "Get the ATG Data"}
                              </button>
                              {atgError && (
                                <span style={{ color: "#c0392b", fontSize: "0.95rem" }}>{atgError}</span>
                              )}
                            </div>
                            <div className="table-wrapper table-wrapper--no-x pricing-table-wrapper" style={{ marginTop: "0.5rem" }}>
                              <table className="matches-table resizable-table pricing-table">
                                <thead>
                                  <tr>
                                    <ResizableTh resize={pricingResize} index={0}>Item Description</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={1}>Qty</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={2}>Unit</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={3}>Unit Price</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={4}>Total Price</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={5}>Unit Manhour</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={6}>Total Manhour</ResizableTh>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="matches-table__row">
                                    <td>
                                      {renderCell(atgRow.description)}
                                    </td>
                                    <td>
                                      <input
                                        className="form-input form-input--table"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={atgRow.qty}
                                        onChange={(e) => handleAtgQtyChange(e.target.value)}
                                      />
                                    </td>
                                    <td>
                                      {renderCell(atgRow.unit)}
                                    </td>
                                    <td>
                                      <input
                                        className="form-input form-input--table"
                                        value={atgRow.unitPrice}
                                        onChange={(e) =>
                                          setAtgRow(prev => {
                                            const unitPrice = roundPrice(e.target.value);
                                            const qty = prev.qty || "0";
                                            return {
                                              ...prev,
                                              unitPrice,
                                              totalPrice: computeTotalPrice(unitPrice, qty),
                                            };
                                          })
                                        }
                                        placeholder="Unit price"
                                      />
                                    </td>
                                    <td>{renderCell(atgRow.totalPrice)}</td>
                                    <td>
                                      {renderCell(atgRow.unitManhour)}
                                    </td>
                                    <td>{renderCell(atgRow.totalManhour)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : section.id === "installation" ? (
                          <div className="pricing-installation">
                            <div
                              className="form-grid"
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "0.75rem",
                                alignItems: "flex-start",
                              }}
                            >
                              <label className="form-field" style={installationFieldStyle}>
                                <span className="form-label">Number of Workers</span>
                                <input
                                  className="form-input"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={installationInputs.workers}
                                  onChange={(e) => handleInstallationChange("workers", e.target.value)}
                                />
                              </label>
                              <label className="form-field" style={installationFieldStyle}>
                                <span className="form-label">Number of Engineers</span>
                                <input
                                  className="form-input"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={installationInputs.engineers}
                                  onChange={(e) => handleInstallationChange("engineers", e.target.value)}
                                />
                              </label>
                              <label className="form-field" style={installationFieldStyle}>
                                <span className="form-label">Number of Supervisors</span>
                                <input
                                  className="form-input"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={installationInputs.supervisors}
                                  onChange={(e) => handleInstallationChange("supervisors", e.target.value)}
                                />
                              </label>
                              <label className="form-field" style={installationFieldStyle}>
                                <span className="form-label">Location</span>
                                <select
                                  className="form-input"
                                  value={installationInputs.location}
                                  onChange={(e) => handleInstallationChange("location", e.target.value)}
                                >
                                  <option value="riyadh">Riyadh</option>
                                  <option value="remote">Remote Area</option>
                                </select>
                              </label>
                            </div>

                            <div className="table-wrapper table-wrapper--no-x pricing-table-wrapper" style={{ marginTop: "0.75rem" }}>
                              <table className="matches-table resizable-table pricing-table">
                                <thead>
                                  <tr>
                                    <ResizableTh resize={pricingResize} index={0}>Metric</ResizableTh>
                                    <ResizableTh resize={pricingResize} index={1}>Value</ResizableTh>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="matches-table__row">
                                    <td>Total number of workers</td>
                                    <td>{formatNumber(installationTotals.totalWorkers)}</td>
                                  </tr>
                                  <tr className="matches-table__row">
                                    <td>Total manhour</td>
                                    <td>{formatNumber(totalManhour)}</td>
                                  </tr>
                                  <tr className="matches-table__row">
                                    <td>Project period</td>
                                    <td>{formatNumber(installationTotals.projectPeriod)}</td>
                                  </tr>
                                  {isRemoteLocation ? (
                                    <>
                                      <tr className="matches-table__row">
                                        <td>Monthly</td>
                                        <td>{formatNumber(installationTotals.monthlyRemote)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Weekly</td>
                                        <td>{formatNumber(installationTotals.weeklyRemote)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Manpower cost</td>
                                        <td>{formatNumber(installationTotals.manpowerRemote)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Installation profit</td>
                                        <td>{formatNumber(installationTotals.profitRemote)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Risk</td>
                                        <td>{formatNumber(installationTotals.riskRemote)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Price</td>
                                        <td>{formatNumber(installationTotals.priceRemote)}</td>
                                      </tr>
                                    </>
                                  ) : (
                                    <>
                                      <tr className="matches-table__row">
                                        <td>Monthly</td>
                                        <td>{formatNumber(installationTotals.monthlyRiyadh)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Weekly</td>
                                        <td>{formatNumber(installationTotals.weeklyRiyadh)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Manpower cost</td>
                                        <td>{formatNumber(installationTotals.manpowerRiyadh)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Installation profit</td>
                                        <td>{formatNumber(installationTotals.profitRiyadh)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Risk</td>
                                        <td>{formatNumber(installationTotals.riskRiyadh)}</td>
                                      </tr>
                                      <tr className="matches-table__row">
                                        <td>Price</td>
                                        <td>{formatNumber(installationTotals.priceRiyadh)}</td>
                                      </tr>
                                    </>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="pricing-placeholder">
                            <h3>{section.label} pricing</h3>
                            <p>We will implement this section soon.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="table-actions" style={{ paddingTop: "1rem" }}>
              <button
                type="button"
                className="btn-match btn-outline"
                onClick={() => setActiveEstimateStep("estimate")}
              >
                Go to Estimate Generation
              </button>
            </div>
          </section>
        )}

        {activePage === "new-estimate" && activeEstimateStep === "estimate" && (
          <section id="estimate" className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Finalize</p>
                <h2 className="section-title section-title--compact">Final Estimate</h2>
              </div>
            </div>
            <div
              className="form-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.75rem",
                marginBottom: "1rem",
                alignItems: "flex-start",
              }}
            >
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span className="form-label">Company Name</span>
                <input
                  className="form-input"
                  type="text"
                  value={estimateCompanyName}
                  onChange={(e) => setEstimateCompanyName(e.target.value)}
                  style={estimateInputPaddedStyle}
                />
              </div>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span className="form-label">Contact Name</span>
                <input
                  className="form-input"
                  type="text"
                  value={estimateContactName}
                  onChange={(e) => setEstimateContactName(e.target.value)}
                  style={estimateInputPaddedStyle}
                />
              </div>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label className="form-label" htmlFor="estimate-project-name">Project Name</label>
                <input
                  id="estimate-project-name"
                  className="form-input"
                  type="text"
                  value={estimateProjectName}
                  onChange={(e) => setEstimateProjectName(e.target.value)}
                  placeholder="Enter project name"
                  style={estimateInputPaddedStyle}
                />
              </div>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label className="form-label" htmlFor="estimate-subject">Subject</label>
                <input
                  id="estimate-subject"
                  className="form-input"
                  type="text"
                  value={estimateSubject}
                  onChange={(e) => setEstimateSubject(e.target.value)}
                  placeholder="Enter subject"
                  style={estimateInputPaddedStyle}
                />
              </div>
            </div>
            {estimateTableRows.length ? (
              <div className="table-wrapper table-wrapper--no-x pricing-table-wrapper" style={{ marginTop: "0.5rem" }}>
                <table className="matches-table resizable-table pricing-table">
                  <thead>
                    <tr>
                      <ResizableTh resize={estimateResize} index={0}>Id</ResizableTh>
                      <ResizableTh resize={estimateResize} index={1}>Description</ResizableTh>
                      <ResizableTh resize={estimateResize} index={2}>Capacity</ResizableTh>
                      <ResizableTh resize={estimateResize} index={3}>Size</ResizableTh>
                      <ResizableTh resize={estimateResize} index={4}>Quantity</ResizableTh>
                      <ResizableTh resize={estimateResize} index={5}>Unit</ResizableTh>
                      <ResizableTh resize={estimateResize} index={6}>Remarks</ResizableTh>
                      <ResizableTh resize={estimateResize} index={7}>Unit Price</ResizableTh>
                      <ResizableTh resize={estimateResize} index={8}>Amount</ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {estimateTableRows.map((row, idx) => (
                      <tr key={`estimate-${idx}`} className="matches-table__row">
                        <td>{idx + 1}</td>
                        <td>{renderCell(row.description)}</td>
                        <td>{renderCell(row.capacity)}</td>
                        <td>{renderCell(row.size)}</td>
                        <td>{renderCell(row.quantity)}</td>
                        <td>{renderCell(row.unit)}</td>
                        <td>{renderCell(row.remarks)}</td>
                        <td>{renderCell(row.unitPrice)}</td>
                        <td>{renderCell(row.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="matches-table__row estimate-summary-row">
                      <td />
                      <td className="estimate-summary-label">Total Excluding VAT</td>
                      <td colSpan={5} />
                      <td />
                      <td className="estimate-summary-value"><strong>{formatNumber(estimateTotals.subtotal)}</strong></td>
                    </tr>
                    <tr className="matches-table__row estimate-summary-row">
                      <td />
                      <td className="estimate-summary-label">Special Discount</td>
                      <td colSpan={4} />
                      <td />
                      <td>
                        <div className="estimate-discount-input" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          <input
                            className="form-input form-input--table"
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={estimateDiscountPct}
                            onChange={(e) => setEstimateDiscountPct(e.target.value)}
                            style={{ width: "5rem" }}
                          />
                          <span style={{ fontWeight: 600 }}>%</span>
                        </div>
                      </td>
                      <td className="estimate-summary-value">
                        <strong>{estimateTotals.discount > 0 ? `-${formatNumber(estimateTotals.discount)}` : formatNumber(0)}</strong>
                      </td>
                    </tr>
                    <tr className="matches-table__row estimate-summary-row">
                      <td />
                      <td className="estimate-summary-label">Total After Discount Excluding VAT</td>
                      <td colSpan={5} />
                      <td />
                      <td className="estimate-summary-value"><strong>{formatNumber(estimateTotals.afterDiscount)}</strong></td>
                    </tr>
                    <tr className="matches-table__row estimate-summary-row">
                      <td />
                      <td className="estimate-summary-label">VAT (15%)</td>
                      <td colSpan={5} />
                      <td />
                      <td className="estimate-summary-value"><strong>{formatNumber(estimateTotals.vat)}</strong></td>
                    </tr>
                    <tr className="matches-table__row estimate-summary-row">
                      <td />
                      <td className="estimate-summary-label">Total Including VAT</td>
                      <td colSpan={5} />
                      <td />
                      <td className="estimate-summary-value"><strong>{formatNumber(estimateTotals.totalWithVat)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="empty-state">No estimate data to show yet.</p>
            )}
            <div className="table-actions" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn-match" onClick={() => void handleGenerateEstimatePdf()}>
                Generate
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

          </section>
        )}

        {showDrawingsOnlyConfirm && (
          <div className="modal-backdrop">
            <div className="modal">
              <p>You only uploaded Drawings, no BOQ is provided, Proceed?</p>
              <div className="modal__actions">
                <button type="button" className="btn-secondary" onClick={handleCancelDrawingsOnly}>
                  No
                </button>
                <button type="button" className="btn-match" onClick={handleConfirmDrawingsOnly}>
                  Yes, proceed
                </button>
              </div>
            </div>
          </div>
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
