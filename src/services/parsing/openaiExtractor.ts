import { config } from "../../config";
import { AttributeMap, ExtractedItem } from "../../types/build";
import { getPromptByKey } from "../../modules/storage/promptRepository";
import { getOpenAiClient } from "../openai/client";
import { getGeminiClient } from "../gemini/client";

export const DRAWING_SYSTEM_PROMPT =
  "You are a rules-aware parser. Always return JSON, and never add explanatory prose outside the JSON.";

export const DRAWING_EXTRACTION_PROMPT = `
You are a Senior Estimation Engineer for an exhibition stand contractor.
Your task is to analyze architectural inputs (Drawings, Renders, Scope of Work) and generate a Bill of Quantities (BOQ) as a JSON Array.

**The BOQ consists of 6 specific categories:**
A. Flooring
B. Wall Structure & Ceiling
C. Custom-made Items (Joinery/Fabrication)
D. Graphics (Branding/Logos)
E. Furniture (Rental loose items)
F. AV (Audio Visual Rental)

**Output Format:**
Return ONLY a valid JSON Array of Objects. No markdown, no conversational text.

**JSON Key Definitions:**
*   "section_code": String ("A", "B", "C", "D", "E", or "F").
*   "item_no": String (e.g., "A.1", "B.1").
*   "description": String (The Item Name and specific feature).
*   "dimensions": String (Format: "Lm L x Wm W x Hm H" or "Lm L x Hm H" or "Lm L x Dm D x Hm H" for walls or "Lm L x Wm W" for ceilings. If N/A, use empty string).
*   "dimensions_reason": String (Briefly explain how you derived the dimensions. Reference drawing annotations if present; otherwise explain the visual estimate and any assumptions/standards used. Do NOT output chain-of-thought; give a short professional justification).

*   "finishes": String (Material specifications, paint type, lighting).
*   "quantity": Number (Float or Integer).
*   "uom": String ("SQM", "LM", "UNIT", "NOS").

**General Estimation Rules:**
1.  **Dimensions:** Extract carefully from drawings, don't make estimations.
2.  **Language:** Use professional construction terminology (e.g., "MDF", "Spray paint", "Tempered glass").
3.  **Extraction:** You will be instructed to extract ONLY ONE category at a time. You must strictly ignore all items belonging to other categories.
`.trim();

export const DRAWING_CATEGORIES = [
  { key: "flooring", label: "Flooring" },
  { key: "walls_and_ceiling", label: "Wall Structure & Ceiling" },
  { key: "custom_items", label: "Custom-made Items" },
  { key: "graphics", label: "Graphics" },
  { key: "furniture", label: "Furniture" },
  { key: "av", label: "AV" },
] as const;

export type DrawingCategoryKey = (typeof DRAWING_CATEGORIES)[number]["key"];
type DrawingCategoryPromptMap = Record<DrawingCategoryKey, string>;

// Category-specific prompt defaults (editable via UI; these are the fallback values)
export const DRAWING_CATEGORY_PROMPT_DEFAULTS: DrawingCategoryPromptMap = {
  flooring: `
  **TASK: Extract SECTION A: FLOORING only.**

**Instructions:**
Ignore all walls, furniture, AV, and graphics. Focus only on the ground surface and platform.

**Methodology & Mandatory Items:**
1.  **Total Area:** Calculate the floor under the booth area (Length x Width) based on the input, don't make estimations based on LED or anything else, find the exact dimensions from the drawings.
2.  **Item A.1 (Mandatory):** You must always include the raised floor.
    *   Description: "Raised platform - Rental"
    *   Quantity: Calculate L x W (get the L and M measures from the drawings, the raised floor under the booth from one the available drawings, or maybe in the text if available, round up the numbers "198 cm = 2 m")
    *   Dimensions: Total Area L x W x 0.10m H
    *   Finishes: "Wooden structure, MDF, Plywood framing"
    *   UOM: SQM
3.  **Item A.2 (Floor Finish):** Identify the visible finish from the render.
    *   Quantity and Dimensions are same as Item A.1
    *   If Wood/Glossy: Description "Floor finish", Finish "Glossy finish laminate".
    *   If Fabric: Description "Floor finish", Finish "Galaxy grade Carpet".
    *   If specified PVC: Description "Floor finish", Finish "PVC Flooring".
    *   UOM: SQM (Matches total area).
4.  **Item A.3 (Skirting):** The edge of the platform.
    *   Quantity: Calculate perimeter of open sides (Total Perimeter minus Wall lengths).
    *   Finishes: "MDF, Spray paint finish".
    *   UOM: LM (Linear Meter).
5.  **Item A.4 (Ramp):** If the booth has a raised floor, include 1 ramp.
    *   Finishes: "Wooden structure, MDF".
    *   UOM: UNIT.
6.  **Item A.5 (Mandatory):** Floor protection.
    *   Description: "Plastic protection"
    *   Finishes: "Consumables"
    *   UOM: SQM (Matches total area).
  `.trim(),
  walls_and_ceiling: `
  **TASK: Extract SECTION B: WALL STRUCTURE & CEILING only.**

**Instructions:**
Ignore flooring, loose furniture, counters, and logos. Focus on the architectural build.
Don't make estimations based on LED or anything else, find the exact dimensions from the drawings.

**Methodology:**
1.  **Decomposition:** Do not group all walls. Break them down by orientation (e.g., "Back wall", "Left wall system", "Right wall system", "Meeting room wall", "Partition wall", "Offset panels").
2.  **Dimensions:** Extract L x D x H.
    *   Standard Depth (D) is 0.10m to 0.20m if not specified.
    *   Height and Length should be extracted from the drawings, don't make any estimations.
3.  **Finishes:**
    *   Standard: "Wooden structure, MDF, Roller paint". (Specify "Bothside" or "Oneside").
    *   Premium features: If the wall is high-gloss or complex, use "Spray paint finish".
    *   Lighting: If the wall has glowing lines/coves, add "with LED strip light incorporated".
    *   Glass Walls/Doors: Description "Glass door - Single/Double". Finish "10mm thick tempered glass with frosted sticker".
4.  **Ceiling:** Extract overhead elements (Rigging, Beams, Slats).
    *   Description: "Ceiling beams" or "Wooden slats".
    *   Finishes: "Wooden structure, MDF, Roller paint finish" (plus "LED strip" if visible).
    * `.trim(),
  custom_items: `
  **TASK: Extract SECTION C: CUSTOM-MADE ITEMS only.**

**Instructions:**
Ignore structural walls (Section B) and rental chairs/tables (Section E). Focus on FABRICATED/JOINERY furniture.
Don't make estimations based on LED or anything else, find the exact dimensions from the drawings.


**Items to Include:**
Reception Desks, Display Podiums, Totems, Kiosks, Bar Counters (if built-in), Meeting Tables (only if custom/heavy joinery).

**Methodology:**
1.  **Description:** Use the specific name from the drawing (e.g., "Reception Table", "Display counter 1").
2.  **Finishes:** Custom items imply high quality.
    *   Standard Spec: "Wooden structure, MDF, Spray paint finish".
    *   Branding: If a logo is on the furniture, add ", with vinyl sticker logo on front".
    *   Lighting: If under-lit or toe-kick lighting is visible, add ", with LED strip light".
    *   Texture: If slats are visible, add ", with MDF slats".
3.  **Dimensions:** Format L x W x H. (e.g., "2.50m L x 0.60m W x 0.90m H").
4.  **UOM:** Always "UNIT".
`.trim(),
  graphics: `
  **TASK: Extract SECTION D: GRAPHICS only.**

**Instructions:**
Ignore the wall or desk the logo is attached to. Extract ONLY the branding elements.

**Methodology:**
1.  **Identify:** Scan ceiling bulkheads, wall headers, and main walls for logos/text.
2.  **Description:** Be specific about location (e.g., "Main Logo on ceiling", "Logo on Bulkhead (LHS)", "Logo on back wall").
3.  **Dimensions:** number of letters * Hm H (example: 7 Letters - 0.10m H).
4.  **Finishes (Rules):**
    *   **Glowing/Light Emitting:** Finish = "Acrylic Front lit Logo".
    *   **3D but Non-Glowing:** Finish = "MDF spray paint nonlit Logo".
    *   **Flat/Painted/Sticker:** Finish = "Vinyl sticker".
    *   **Canvas Prints:** Finish = "Printed graphics with frame".
5.  **UOM:** "UNIT".
`.trim(),
  furniture: `
  **TASK: Extract SECTION E: FURNITURE only.**

**Instructions:**
Ignore built-in custom counters (Section C). Focus on LOOSE / RENTAL items.

**Methodology:**
1.  **Description:** Always append " - Rental" to the item name. (e.g., "Bar Stool - Rental", "Fridge - Rental").
2.  **Finishes:** Do not invent materials for rental items. Use this exact phrase: "Selected from the standard range and subject to availability".
3.  **Dimensions:** Usually empty string "" unless capacity is known (e.g. "200L" for fridge).
4.  **Quantity:** Count carefully from the render or text list.
5.  **UOM:** "NOS" (Numbers) or "UNIT".
`.trim(),
  av: `
  **TASK: Extract SECTION F: AV (AUDIO VISUAL) only.**

**Instructions:**
Ignore static graphics and lighting fixtures. Focus on digital screens.
Count all the AV in the booth

**Items to Include:**
LED Video Walls, LCD TVs, Screens.

**Methodology:**
1.  **Description:** Item Name + " - Rental".
2.  **LED Walls:**
    *   Description: "LED Wall - Rental" (or "LED on wall").
    *   Dimensions: Extract specific L x H (e.g., "3.50m L x 2.00m H").
    *   Finishes: "P 2.6 LED" or "P 2.9mm P".
3.  **TVs:**
    *   Description: "TV (Screen)".
    *   Finishes: Spec the size (e.g., "65 inch", "55 inch", "24 inch").
4.  **UOM:** "UNIT" or "NOS".
`.trim(),
};

export async function getDrawingExtractionPrompt(): Promise<string> {
  try {
    const stored = await getPromptByKey("drawing-extraction");
    const content = stored?.content?.trim();
    return content && content.length > 0 ? content : DRAWING_EXTRACTION_PROMPT;
  } catch (error) {
    console.error("[prompts] Failed to load drawing prompt, falling back to default:", error);
    return DRAWING_EXTRACTION_PROMPT;
  }
}

async function getDrawingCategoryPrompts(): Promise<DrawingCategoryPromptMap> {
  const resolved: DrawingCategoryPromptMap = { ...DRAWING_CATEGORY_PROMPT_DEFAULTS };

  await Promise.allSettled(
    DRAWING_CATEGORIES.map(async ({ key }) => {
      const stored = await getPromptByKey(`drawing-${key}-extraction`);
      const content = stored?.content?.trim();
      if (content && content.length > 0) {
        resolved[key] = content;
      }
    })
  );

  return resolved;
}

export async function parseJsonFromMessage(message: string): Promise<unknown> {
  const arrayMatch = message.match(/\[[\s\S]*\]/);
  const objectMatch = message.match(/\{[\s\S]*\}/);
  const jsonMatch = arrayMatch?.[0] ?? objectMatch?.[0];
  if (!jsonMatch) {
    throw new Error("OpenAI response did not include JSON");
  }
  return JSON.parse(jsonMatch);
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return String(value);
}

export function toItemsArray(payload: unknown): ExtractedItem[] {
  const items = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === "object" && "items" in (payload as Record<string, unknown>))
      ? (payload as Record<string, unknown>).items
      : null;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .map((record) => {
      const sectionCode =
        toOptionalString((record as Record<string, unknown>).section_code) ??
        toOptionalString((record as Record<string, unknown>).sectionCode) ??
        toOptionalString((record as Record<string, unknown>).section);
      const itemNo =
        toOptionalString((record as Record<string, unknown>).item_no) ??
        toOptionalString((record as Record<string, unknown>).itemNo) ??
        toOptionalString(record.item_number);
      const dimensions =
        toOptionalString((record as Record<string, unknown>).dimensions) ?? toOptionalString(record.size);
      const dimensionsReason =
        toOptionalString((record as Record<string, unknown>).dimensions_reason) ??
        toOptionalString((record as Record<string, unknown>).dimensionsReason) ??
        toOptionalString((record as Record<string, unknown>).dimension_reason) ??
        toOptionalString((record as Record<string, unknown>).dimensionReasoning) ??
        toOptionalString((record as Record<string, unknown>).dimension_reasoning);
      const finishes =
        toOptionalString((record as Record<string, unknown>).finishes) ??
        toOptionalString((record as Record<string, unknown>).finish);
      const unit = toOptionalString(record.unit ?? (record as Record<string, unknown>).uom);

      return {
        section_code: sectionCode,
        section_name: toOptionalString((record as Record<string, unknown>).section_name ?? (record as Record<string, unknown>).sectionName),
        item_no: itemNo,
        item_number: itemNo ?? toOptionalString(record.item_number),
        item_type: toOptionalString(record.item_type),
        description: toOptionalString(record.description),
        capacity: toOptionalString(record.capacity),
        dimensions,
        dimensions_reason: dimensionsReason ?? toOptionalString(record.remarks),
        size: dimensions ?? toOptionalString(record.size),
        quantity: toOptionalString(record.quantity),
        finishes,
        unit,
        remarks: toOptionalString(record.remarks),
        unit_price: toOptionalString(record.unit_price),
        total_price: toOptionalString(record.total_price),
        location: toOptionalString(record.location),
        unit_manhour: toOptionalString(record.unit_manhour),
        total_manhour: toOptionalString(record.total_manhour),
        full_description: toOptionalString(record.full_description ?? finishes),
      };
    });
}

function structuredItemsToAttributeMap(items: ExtractedItem[]): AttributeMap {
  return items.reduce<AttributeMap>((acc, item, index) => {
    const label = item.item_number || item.item_no || item.description || `Item ${index + 1}`;

    const normalizedSize = item.dimensions ?? item.size;

    const parts: string[] = [];
    if (item.section_code) parts.push(`Section ${item.section_code}`);
    if (item.item_type) parts.push(`[${item.item_type}]`);
    if (item.description) parts.push(item.description);
    if (item.capacity) parts.push(`Capacity: ${item.capacity}`);
    if (normalizedSize) parts.push(`Size: ${normalizedSize}`);
    if (item.quantity || item.unit) {
      parts.push(`Qty: ${item.quantity ?? ""}${item.unit ? ` ${item.unit}` : ""}`.trim());
    }
    if (item.finishes) parts.push(`Finishes: ${item.finishes}`);
    if (item.full_description) parts.push(item.full_description);

    acc[label] = parts.filter(Boolean).join(" | ") || "—";
    return acc;
  }, {});
}

type ExtractAttributesOptions = {
  promptOverride?: string;
  systemPromptOverride?: string;
};

export async function extractAttributesWithOpenAI(
  rawText: string,
  fileName: string,
  options?: ExtractAttributesOptions
): Promise<{ attributes: AttributeMap; items: ExtractedItem[]; totalPrice?: string; rawContent?: string }> {
  const trimmed = rawText.replace(/\s+/g, " ");
  const [basePrompt, categoryPrompts] = await Promise.all([
    options?.promptOverride ?? getDrawingExtractionPrompt(),
    getDrawingCategoryPrompts(),
  ]);
  const systemPrompt = options?.systemPromptOverride ?? DRAWING_SYSTEM_PROMPT;
  const client = getOpenAiClient();

  const categoryResponses = await Promise.allSettled(
    DRAWING_CATEGORIES.map(async (category) => {
      const categoryPrompt = categoryPrompts[category.key];
      const userPrompt = [
        basePrompt,
        `Category focus: ${category.label}`,
        "Only include items for this category; ignore all other categories.",
        categoryPrompt ? `Category-specific rules:\n${categoryPrompt}` : null,
        `Build document name: ${fileName}`,
        trimmed,
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await client.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_completion_tokens: 8000,
      });

      const choice = response.choices?.[0];
      const rawMessage = choice?.message?.content ?? "";
      const finishReason = choice?.finish_reason;

      if (finishReason === "length") {
        throw new Error(
          `Category ${category.label} response was truncated. Consider increasing max_completion_tokens or splitting the document.`
        );
      }

      const parsed = await parseJsonFromMessage(rawMessage);
      const items = toItemsArray(parsed);
      return { categoryKey: category.key as DrawingCategoryKey, items, rawContent: rawMessage };
    })
  );

  const combinedItems: ExtractedItem[] = [];
  const rawContentByCategory: Record<DrawingCategoryKey, string> = {
    flooring: "",
    walls_and_ceiling: "",
    custom_items: "",
    graphics: "",
    furniture: "",
    av: "",
  };
  const errors: string[] = [];

  categoryResponses.forEach((result, index) => {
    const { key, label } = DRAWING_CATEGORIES[index];
    if (result.status === "fulfilled") {
      combinedItems.push(...result.value.items);
      rawContentByCategory[key] = result.value.rawContent;
    } else {
      errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });

  const attributes = structuredItemsToAttributeMap(combinedItems);
  const rawContent = JSON.stringify({ categories: rawContentByCategory, errors }, null, 2);

  return { attributes, items: combinedItems, totalPrice: undefined, rawContent };
}

function toPdfInlineDataPart(pdfBuffer: Buffer) {
  return {
    inlineData: {
      data: pdfBuffer.toString("base64"),
      mimeType: "application/pdf",
    },
  } as const;
}

export async function extractAttributesFromPdfWithGemini(
  pdfBuffer: Buffer,
  fileName: string,
  options?: ExtractAttributesOptions
): Promise<{ attributes: AttributeMap; items: ExtractedItem[]; totalPrice?: string; rawContent?: string }> {
  const [basePrompt, categoryPrompts] = await Promise.all([
    options?.promptOverride ?? getDrawingExtractionPrompt(),
    getDrawingCategoryPrompts(),
  ]);

  const systemPrompt = options?.systemPromptOverride ?? DRAWING_SYSTEM_PROMPT;
  const gemini = getGeminiClient();
  const model = gemini.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: systemPrompt,
  });

  const pdfPart = toPdfInlineDataPart(pdfBuffer);

  const categoryResponses = await Promise.allSettled(
    DRAWING_CATEGORIES.map(async (category) => {
      const categoryPrompt = categoryPrompts[category.key];
      const schemaEnforcement = [
        "IMPORTANT JSON SCHEMA REQUIREMENTS (must follow even if other prompts disagree):",
        '- Your response MUST be a JSON Array of Objects (no wrapper object, no markdown).',
        '- For EVERY item object you output, you MUST include a non-empty string field: "dimensions_reason".',
        '- "dimensions_reason" must briefly justify how you derived the dimensions (e.g., drawing callout reference, scale-based estimate, standard booth assumptions).',
        "- Do NOT provide chain-of-thought. Keep it short, professional, and directly tied to the chosen dimension values.",
        '- If the drawing has no explicit dimension, still set a best estimate and explain the assumption in "dimensions_reason".',
      ].join("\n");

      const userPrompt = [
        basePrompt,
        schemaEnforcement,
        `Category focus: ${category.label}`,
        "Only include items for this category; ignore all other categories.",
        categoryPrompt ? `Category-specific rules:\n${categoryPrompt}` : null,
        `Build document name: ${fileName}`,
        "Analyze the attached PDF drawings/renders as the source of truth.",
        "Return ONLY a JSON Array of Objects (no markdown, no extra text).",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [pdfPart, { text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
        },
      });

      const rawMessage = result.response.text() ?? "";

      const parsed = await parseJsonFromMessage(rawMessage);
      const items = toItemsArray(parsed);
      return { categoryKey: category.key as DrawingCategoryKey, items, rawContent: rawMessage };
    })
  );

  const combinedItems: ExtractedItem[] = [];
  const rawContentByCategory: Record<DrawingCategoryKey, string> = {
    flooring: "",
    walls_and_ceiling: "",
    custom_items: "",
    graphics: "",
    furniture: "",
    av: "",
  };
  const errors: string[] = [];

  categoryResponses.forEach((result, index) => {
    const { key, label } = DRAWING_CATEGORIES[index];
    if (result.status === "fulfilled") {
      combinedItems.push(...result.value.items);
      rawContentByCategory[key] = result.value.rawContent;
    } else {
      errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });

  const attributes = structuredItemsToAttributeMap(combinedItems);
  const rawContent = JSON.stringify({ categories: rawContentByCategory, errors }, null, 2);

  return { attributes, items: combinedItems, totalPrice: undefined, rawContent };
}

