import path from "path";
import { config } from "../../config";
import { getGeminiClient } from "./client";
import { MediaResolution } from "@google/genai";
import { parseWithLandingAiToMarkdown } from "../landingai/parseToMarkdown";

function mimeTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

const SYSTEM_INSTRUCTION = `You are an expert architectural drawing reader and transcription assistant. You specialize in reading technical drawings, floor plans, elevations, and booth/stand designs. You can read dimension lines, annotations, and measurements with perfect accuracy.`;

function buildPrompt(): string {
  return `You are looking at architectural/technical drawings. Your task is to extract and transcribe EVERYTHING visible into Markdown format.

## CRITICAL: DIMENSIONS
This is the most important part. You MUST read and include ALL dimensions shown in the drawings:
- Read ALL dimension lines (the lines with arrows/ticks at both ends that show measurements)
- Read ALL measurement values (e.g., 3000, 2.5m, 10'-0", 1200mm, etc.)
- For each element/object, note its dimensions: Length × Width × Height
- Include dimensions from ALL views: floor plans, elevations, sections, details
- Look for dimension strings (chains of dimensions)
- Read small text annotations that show sizes

## What to extract for EACH page/view:

### 1. Title and Page Info
- Page title, drawing number, scale, revision

### 2. Every Object/Element with its EXACT dimensions:
Format each item as:
**[Item Name]**: [Description] | Dimensions: [L] × [W] × [H] or as shown

### 3. All Text and Labels
- Room names, area labels
- Material callouts
- Notes and specifications
- Legend items

### 4. Dimension Annotations
List ALL dimension values you can see, organized by what they measure:
- Overall dimensions
- Wall dimensions
- Opening dimensions (doors, windows)
- Furniture/fixture dimensions
- Heights
- Depths

## Output Format
Use Markdown with:
- Headings for each page/view
- Tables for organized data
- Lists for dimensions

## Rules
- Extract EXACT values as shown (do not convert units unless both are shown)
- Do NOT skip any dimension - even small ones matter
- Do NOT estimate or assume - only transcribe what is visible
- Include units exactly as shown (mm, m, cm, ft, in, etc.)
- If a dimension is partially visible or unclear, note it as "[unclear: approximately X]"

## Additional OCR/Parse Reference (if provided)
You may also receive a \"LandingAI parsed Markdown\" version of the same PDF. Use it ONLY as a reference to improve completeness (help find text/dimensions),
but always prefer values you can verify from the PDF itself. Do not invent anything.

Start transcribing now. Be thorough - every dimension matters.`;
}

/**
 * Wait for an uploaded file to finish processing.
 * Gemini files go through PROCESSING state before becoming ACTIVE.
 */
async function waitForFileReady(
  ai: ReturnType<typeof getGeminiClient>,
  fileName: string,
  maxWaitMs = 120000
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const file = await ai.files.get({ name: fileName });
      const state = (file as any).state;

      if (state === "ACTIVE") {
        return; // File is ready
      }
      if (state === "FAILED") {
        throw new Error(`File processing failed: ${(file as any).error?.message || "Unknown error"}`);
      }
      // Still PROCESSING, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (err: any) {
      // If it's a "not found" or transient error, keep waiting
      if (err.message?.includes("FAILED")) throw err;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  throw new Error(`Timeout waiting for file to be ready after ${maxWaitMs}ms`);
}

export async function generateDrawingMarkdownWithGemini(params: {
  filePath: string;
  fileName: string;
}): Promise<{ markdown: string; rawText: string; debug?: any }> {
  // Fail soft: if Gemini isn't configured, return empty markdown so the app continues to work.
  if (!config.geminiApiKey) {
    console.warn("[Gemini] GEMINI_API_KEY not set, skipping markdown generation");
    return { markdown: "", rawText: "" };
  }

  const ai = getGeminiClient();
  const mimeType = mimeTypeFromFileName(params.fileName);

  // Optional: parse the PDF with LandingAI first, then provide its markdown alongside the PDF to Gemini.
  let landingMarkdown = "";
  let landingDebug: any = null;
  if (mimeType === "application/pdf" && config.landingAiApiKey) {
    try {
      console.log(`[LandingAI] Parsing PDF to markdown: ${params.fileName}`);
      const parsed = await parseWithLandingAiToMarkdown({ filePath: params.filePath, fileName: params.fileName });
      landingMarkdown = (parsed.markdown || "").trim();
      landingDebug = parsed.debug ?? null;
      console.log(`[LandingAI] Parsed markdown length: ${landingMarkdown.length}`);
    } catch (err) {
      landingDebug = {
        error: err instanceof Error ? err.message : String(err),
        attempts: (err as any)?.attempts ?? null,
      };
      console.error("[LandingAI] Parse failed (continuing without it):", err);
    }
  }

  console.log(`[Gemini] Uploading file: ${params.fileName} (${mimeType})`);

  // Upload file so we can pass the full binary (PDF/images) to Gemini.
  const uploaded = await ai.files.upload({
    file: params.filePath,
    config: {
      mimeType,
      displayName: params.fileName,
    },
  });

  console.log(`[Gemini] File uploaded: ${uploaded.name}, state: ${(uploaded as any).state}`);

  // Wait for the file to finish processing (especially important for PDFs)
  if ((uploaded as any).state === "PROCESSING") {
    console.log("[Gemini] Waiting for file processing to complete...");
    await waitForFileReady(ai, uploaded.name!);
    console.log("[Gemini] File ready");
  }

  console.log(`[Gemini] Generating content with model: ${config.geminiModel}`);

  const geminiRequest = {
    model: config.geminiModel,
    contents: [
      { fileData: { fileUri: uploaded.uri, mimeType } },
      ...(landingMarkdown
        ? [
          {
            text:
              "LandingAI parsed Markdown (reference; verify against PDF, do not invent):\n\n" +
              landingMarkdown.slice(0, 200000),
          },
        ]
        : []),
      { text: buildPrompt() },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingConfig: {
        thinkingBudget: Number.isFinite(config.geminiThinkingBudget) ? config.geminiThinkingBudget : 16384,
      },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      temperature: 0,
      maxOutputTokens: 65536,
    },
  };

  const response = await ai.models.generateContent({
    ...geminiRequest,
  });

  const text = (response as any)?.text ?? "";

  if (!text) {
    console.warn("[Gemini] Empty response received");
  } else {
    console.log(`[Gemini] Received ${text.length} characters`);
  }

  return {
    markdown: String(text || ""),
    rawText: String(text || ""),
    debug: {
      landingAi: {
        enabled: !!config.landingAiApiKey && mimeType === "application/pdf",
        markdownLength: landingMarkdown.length,
        markdownPreview: landingMarkdown.slice(0, 4000),
        debug: landingDebug,
      },
      geminiRequest: {
        // Avoid logging huge payloads; include a safe summary for browser console.
        model: geminiRequest.model,
        file: { mimeType, fileUri: uploaded.uri },
        config: geminiRequest.config,
        textParts: geminiRequest.contents
          .filter((p: any) => typeof p?.text === "string")
          .map((p: any) => ({
            length: (p.text as string).length,
            preview: (p.text as string).slice(0, 1200),
          })),
      },
    },
  };
}
