import { useEffect, useMemo, useState } from "react";
import type { CandidateMatch, BuildSummary, AttributeMap, AttributeValue } from "./types";
import type { PaginatedResponse } from "./services/api";
import {
  fetchKnowledgeBase,
  fetchStats,
  uploadMultipleEstimates,
  requestMatches,
  createBuildFromTemplate
} from "./services/api";

const ITEMS_PER_PAGE = 10;

// Helper function to get attribute value (handles both old and new format)
function getAttributeValue(attr: string | AttributeValue | undefined): string {
  if (!attr) return "—";
  if (typeof attr === 'string') return attr;
  return attr.value || "—";
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
              <table className="attributes-table">
                <thead>
                  <tr>
                    <th>Attribute</th>
                    <th>Value</th>
                    <th>Price</th>
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

function App() {
  const [knowledgeBase, setKnowledgeBase] = useState<BuildSummary[]>([]);
  const [totalBuilds, setTotalBuilds] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [matchingFile, setMatchingFile] = useState<File | null>(null);
  const [processingAI, setProcessingAI] = useState(false);
  const [matching, setMatching] = useState(false);
  const [searchResults, setSearchResults] = useState<CandidateMatch[]>([]);
  const [feedback, setFeedback] = useState<string>("");
  const [loadingStage, setLoadingStage] = useState(0);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);
  const [selectedTemplateAttributes, setSelectedTemplateAttributes] = useState<AttributeMap>({});

  const maxAttributesInFile = useMemo(() => {
    if (knowledgeBase.length === 0) return 0;
    return Math.max(...knowledgeBase.map(build => Object.keys(build.attributes).length));
  }, [knowledgeBase]);

  useEffect(() => {
    refreshHistory();
    loadStats();
  }, [currentPage]);

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

  const handleMatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!matchingFile) {
      setFeedback("Upload a new build to find closest matches.");
      setTimeout(() => setFeedback(""), 3000);
      return;
    }
    setMatching(true);
    setProcessingAI(true);
    setFeedback("");
    setLoadingStage(0);

    // Animate through loading stages
    const stages = [
      "Analyzing the document...",
      "AI is extracting attributes...",
      "Searching knowledge base...",
      "AI is thinking and ranking results..."
    ];

    const stageInterval = setInterval(() => {
      setLoadingStage(prev => {
        const next = prev + 1;
        return next < stages.length ? next : prev;
      });
    }, 1500);

    try {
      const payload = await requestMatches({
        file: matchingFile ?? undefined,
        limit: 5,
      });
      clearInterval(stageInterval);
      setSearchResults(payload.matches ?? []);
      const message = payload.matches && payload.matches.length > 0
        ? "Closest matches found."
        : "No matches were returned.";
      setFeedback(message);
      setTimeout(() => setFeedback(""), 3000);
    } catch (error) {
      clearInterval(stageInterval);
      const errorMessage = (error as Error).message;
      setFeedback(errorMessage);
      setTimeout(() => setFeedback(""), 5000);
      setSearchResults([]);
    } finally {
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

  const loadingMessages = [
    "Analyzing the document...",
    "AI is extracting attributes...",
    "Searching knowledge base...",
    "AI is thinking and ranking results..."
  ];

  const processingMessage = processingAI
    ? matching
      ? loadingMessages[loadingStage] || loadingMessages[0]
      : "Processing build via OpenAI..."
    : "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
              <path d="M12 16L16 20L24 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="brand__title">AI Powered Estimation System</p>
          </div>
        </div>

        <nav className="sidebar__nav">
          <a href="#knowledge" className="nav-link">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 4h14M3 10h14M3 16h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Knowledge Base</span>
          </a>
          <a href="#matches" className="nav-link">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M10 6v8M6 10h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>New Estimate</span>
          </a>
        </nav>

        <div className="sidebar__stats">
          <div className="stat-card">
            <div className="stat-card__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M9 12h6M9 16h6M16 6v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="stat-card__content">
              <p className="stat-card__label">Total Builds</p>
              <strong className="stat-card__value">{totalBuilds}</strong>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--secondary">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <div className="stat-card__content">
              <p className="stat-card__label">Max Attributes</p>
              <strong className="stat-card__value">{maxAttributesInFile}</strong>
            </div>
          </div>
        </div>

        <div className="sidebar__footer">
          <div className="sidebar__kb-preview">
            <p className="sidebar__kb-title">Recent Uploads</p>
            {knowledgeBase.slice(0, 3).map((build) => (
              <div key={build.id} className="sidebar__kb-item" onClick={() => handleRowClick(build.link_to_file)}>
                <div className="kb-item__icon">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M9 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="kb-item__content">
                  <p className="kb-item__name">{build.originalName}</p>
                  <span className="kb-item__date">{new Date(build.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
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
                      <div className="progress-bar__fill" style={{ width: `${(loadingStage + 1) * 25}%` }} />
                    </div>
                    <span className="progress-text">Step {loadingStage + 1} of 4</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <header className="hero">
          <div>
            <p className="eyebrow">Estimation Knowledge Base</p>
            <h1>Upload, parse, and compare every Estimate</h1>
          </div>
          <div className="hero__stats">
            <div>
              <p>Verified builds</p>
              <strong>{totalBuilds}</strong>
            </div>
            <div>
              <p>Attributes tracked</p>
              <strong>{maxAttributesInFile}</strong>
            </div>
          </div>
        </header>

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
                <table className="kb-table kb-table--compact">
                  <thead>
                    <tr>
                      <th className="kb-table__col-filename">File Name</th>
                      <th className="kb-table__col-date">Date</th>
                      <th>CPU</th>
                      <th>CPU Cooler</th>
                      <th>Motherboard</th>
                      <th>Memory</th>
                      <th>Storage</th>
                      <th>Video Card</th>
                      <th>Case</th>
                      <th>Power Supply</th>
                      <th>Operating System</th>
                      <th>Monitor</th>
                      <th className="kb-table__col-price">Price</th>
                      <th className="kb-table__col-id">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledgeBase.map((build) => (
                      <tr
                        key={build.id}
                        onClick={() => handleRowClick(build.link_to_file)}
                        className="kb-table__row"
                      >
                        <td className="kb-table__filename">{build.originalName}</td>
                        <td className="kb-table__date">{new Date(build.createdAt).toLocaleDateString()}</td>
                        <td>{getAttributeValue(build.attributes.CPU || build.attributes.cpu)}</td>
                        <td>{getAttributeValue(build.attributes["CPU Cooler"])}</td>
                        <td>{getAttributeValue(build.attributes.Motherboard)}</td>
                        <td>{getAttributeValue(build.attributes.Memory || build.attributes.memory)}</td>
                        <td>{getAttributeValue(build.attributes.Storage || build.attributes.storage)}</td>
                        <td>{getAttributeValue(build.attributes["Video Card"] || build.attributes.gpu)}</td>
                        <td>{getAttributeValue(build.attributes.Case)}</td>
                        <td>{getAttributeValue(build.attributes["Power Supply"])}</td>
                        <td>{getAttributeValue(build.attributes["Operating System"])}</td>
                        <td>{getAttributeValue(build.attributes.Monitor)}</td>
                        <td className="kb-table__price">{build.totalPrice || "—"}</td>
                        <td className="kb-table__id">{build.requestId.slice(0, 8)}</td>
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

        <section id="matches" className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">New estimate</p>
              <h2>Identify Similar Estimates from Knowledge Base</h2>
            </div>
            <span className="status">{matching ? "Matching…" : "Idle"}</span>
          </div>
          <form className="estimate-form" onSubmit={handleMatch}>
            <div className="estimate-form__upload">
              <label className="dropzone dropzone--estimate">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(event) => setMatchingFile(event.target.files?.[0] ?? null)}
                />
                <div className="dropzone__content">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="dropzone__icon">
                    <path d="M24 16v16M16 24h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <p className="dropzone__text">
                    {matchingFile ? matchingFile.name : "Drag & drop or browse for a build document"}
                  </p>
                  {matchingFile && <span className="dropzone__hint">File ready to analyze</span>}
                </div>
              </label>
              <button type="submit" className="btn-match" disabled={matching || !matchingFile}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
                  <path d="M13 13l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {matching ? "Finding matches…" : "Find Matches"}
              </button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="table-wrapper">
              <table className="matches-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>File Name</th>
                    <th>CPU</th>
                    <th>Score</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((result, index) => {
                    const isBest = index === 0;
                    const filePath = result.filePath || "";
                    return (
                      <tr
                        key={result.id ?? index}
                        className={isBest ? "matches-table__row--best" : "matches-table__row"}
                      >
                        <td className="matches-table__rank">{index + 1}</td>
                        <td
                          className="matches-table__filename"
                          onClick={() => filePath && window.open(`/files/${filePath.split(/[/\\]/).pop()}`, "_blank")}
                          style={{ cursor: filePath ? 'pointer' : 'default' }}
                        >
                          {result.fileName || result.id}
                        </td>
                        <td>{getAttributeValue(result.attributes.CPU || result.attributes.cpu)}</td>
                        <td className="matches-table__score">
                          {result.score !== undefined ? result.score.toFixed(2) : "—"}
                        </td>
                        <td className="matches-table__actions">
                          <button
                            className="btn-template"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUseAsTemplate(result.attributes);
                            }}
                          >
                            Use as Template
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {searchResults.length === 0 && (
            <p className="empty-state">No matches yet. Upload a file to get started.</p>
          )}
        </section>

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
    </div>
  );
}

export default App;
