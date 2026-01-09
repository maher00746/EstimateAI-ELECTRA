import { config } from "../../config";
import { AttributeMap, ExtractedItem } from "../../types/build";
import { getPromptByKey } from "../../modules/storage/promptRepository";
import { getOpenAiClient } from "../openai/client";

export const DRAWING_SYSTEM_PROMPT =
  "You are a rules-aware parser. Always return JSON, and never add explanatory prose outside the JSON.";

export const DRAWING_EXTRACTION_PROMPT = `
You are a senior MEP estimator specializing in fuel systems. Extract every measurable component from the supplied MEP drawings and return them in structured JSON format. Be thorough and accurate.

═══════════════════════════════════════════════════════════════════
EXTRACTION SCOPE (in priority order)
═══════════════════════════════════════════════════════════════════

1. TANKS
   - Storage Tanks (extract capacity in Liters or Gallons)
   - Day Tanks (extract capacity in Liters or Gallons)

2. PUMPS
   - Fuel Pumps / Transfer Pumps (extract GPM/LPM flow rate, PSI pressure)

3. VALVES (count ALL instances by size)
   - BV = Ball Valve
   - CV = Check Valve  
   - Gate Valve
   - Butterfly Valve
   - Relief Valve

4. PIPING (measure total length by size/material)
   - All pipe runs with different diameters
   - Material type if specified (steel, copper, HDPE, etc.)

5. ACCESSORIES
   - Filling Points / Fill Points
   - Strainers (Y-strainer, etc.)
   - Flexible Hoses / Flexible Connectors
   - Tank Vents / Vent Caps
   - Unions / Flanges / Couplings

6. INSTRUMENTATION & CONTROLS
   - Level Probes / Level Transmitters
   - Level Switches / Float Switches
   - Leak Sensors / Leak Detection
   - Overfill Alarms / High Level Alarms
   - Pressure Gauges
   - Flow Meters

7. CONTROL SYSTEMS
   - Master Control Panel (MCP)
   - Local Control Panels
   - Junction Boxes

8. ELECTRICAL MATERIALS
   - Conduits (with sizes)
   - Wiring / Cables (with sizes)
   - Cable Trays

═══════════════════════════════════════════════════════════════════
SIZE CONVERSION TABLE (use these exact values)
═══════════════════════════════════════════════════════════════════

| Inches | mm  |     | Inches | mm  |
|--------|-----|-----|--------|-----|
| 1/2"   | 15  |     | 3"     | 80  |
| 3/4"   | 20  |     | 4"     | 100 |
| 1"     | 25  |     | 5"     | 125 |
| 1-1/4" | 32  |     | 6"     | 150 |
| 1-1/2" | 40  |     | 8"     | 200 |
| 2"     | 50  |     | 10"    | 250 |
| 2-1/2" | 65  |     | 12"    | 300 |

═══════════════════════════════════════════════════════════════════
EXTRACTION RULES
═══════════════════════════════════════════════════════════════════

1. COUNTING & AGGREGATION
   - Group identical items by type AND size (e.g., "BV 80mm" counted separately from "BV 100mm")
   - Count every occurrence shown on the drawing
   - For valves: determine size from the connecting pipe diameter
   - For pipes: sum total linear length per size

2. SIZE HANDLING
   - Convert ALL inch sizes to mm using the table above
   - Format sizes as "XXmm" (e.g., "80mm", "100mm")
   - Keep capacity values as-is (e.g., "10000L", "500 Gal")

3. UNITS
   - Use "Nos" for discrete items (tanks, valves, pumps, sensors, etc.)
   - Use "LM" (Linear Meters) for pipes and conduits
   - Use "M" for cables/wiring

4. EXCLUSIONS (DO NOT EXTRACT)
   - Civil works: concrete pads, foundations, walls, trenches
   - Structural elements: supports, hangers, brackets
   - Labels/legends without physical items

═══════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════

Return a JSON array. Each item must have these fields:

[
  {
    "item_number": "1",
    "item_type": "STORAGE_TANK",
    "description": "Storage Tank",
    "capacity": "10000L",
    "size": "",
    "quantity": "1",
    "unit": "Nos"
  },
  {
    "item_number": "2", 
    "item_type": "BALL_VALVE",
    "description": "Ball Valve (BV)",
    "capacity": "",
    "size": "80mm",
    "quantity": "4",
    "unit": "Nos"
  },
  {
    "item_number": "3",
    "item_type": "PIPE",
    "description": "Steel Pipe",
    "capacity": "",
    "size": "100mm",
    "quantity": "45",
    "unit": "LM"
  }
]

Field definitions:
- item_number: Sequential number starting from "1"
- item_type: Category code (STORAGE_TANK, DAY_TANK, PUMP, EMERGENCY_VENT, BALL_VALVE, CHECK_VALVE, GATE_VALVE, PIPE, STRAINER, FLEXIBLE_HOSE, VENT, LEVEL_INDICATOR, LEVEL_SWITCH, LEAK_SENSOR, CONTROL_PANEL, FILLING_POINT, CONDUIT, CABLE, OTHER)
- description: Clear item name as shown on drawing
- capacity: Tank capacity or pump flow rate (leave empty if not applicable)
- size: Diameter in mm or dimension (leave empty if not applicable)
- quantity: Total count or total length
- unit: "Nos" or "LM" or "M"

═══════════════════════════════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════════════════════════════

Before returning your response, verify:
□ All tanks extracted with capacity
□ All pumps extracted with GPM/PSI
□ All BV and CV counted by size
□ All pipe runs measured by size
□ All sizes converted to mm
□ Quantities are totals (not per-line)
□ No civil items included
□ JSON is valid and complete
`.trim();

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

export async function parseJsonFromMessage(message: string): Promise<unknown> {
  const arrayMatch = message.match(/\[[\s\S]*\]/);
  const objectMatch = message.match(/\{[\s\S]*\}/);
  const jsonMatch = arrayMatch?.[0] ?? objectMatch?.[0];
  if (!jsonMatch) {
    throw new Error("OpenAI response did not include JSON");
  }
  return JSON.parse(jsonMatch);
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
    .map((record) => ({
      item_number: record.item_number as string | undefined,
      item_type: record.item_type as string | undefined,
      description: record.description as string | undefined,
      capacity: record.capacity as string | undefined,
      size: record.size as string | undefined,
      quantity: record.quantity as string | undefined,
      unit: record.unit as string | undefined,
      full_description: record.full_description as string | undefined,
    }));
}

function structuredItemsToAttributeMap(items: ExtractedItem[]): AttributeMap {
  return items.reduce<AttributeMap>((acc, item, index) => {
    const label = item.item_number || item.description || `Item ${index + 1}`;

    const parts: string[] = [];
    if (item.item_type) parts.push(`[${item.item_type}]`);
    if (item.description) parts.push(item.description);
    if (item.capacity) parts.push(`Capacity: ${item.capacity}`);
    if (item.size) parts.push(`Size: ${item.size}`);
    if (item.quantity || item.unit) {
      parts.push(`Qty: ${item.quantity ?? ""}${item.unit ? ` ${item.unit}` : ""}`.trim());
    }
    if (item.full_description) parts.push(item.full_description);

    acc[label] = parts.filter(Boolean).join(" | ") || "—";
    return acc;
  }, {});
}

export async function extractAttributesWithOpenAI(
  rawText: string,
  fileName: string
): Promise<{ attributes: AttributeMap; items: ExtractedItem[]; totalPrice?: string; rawContent?: string }> {
  const trimmed = rawText.replace(/\s+/g, " ");
  const prompt = await getDrawingExtractionPrompt();
  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: "gpt-5.2", // drawings extractor should use the latest OpenAI model
    messages: [
      {
        role: "system",
        content: DRAWING_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `${prompt}\n\nBuild document name: ${fileName}\n\n${trimmed}`,
      },
    ],
    temperature: 0,
    max_completion_tokens: 8000, // Increased to handle large documents with many attributes
  });

  const choice = response.choices?.[0];
  const rawMessage = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason;

  // Check if the response was truncated
  if (finishReason === 'length') {
    throw new Error("The document is too large. OpenAI response was truncated. Please increase max_completion_tokens or split the document.");
  }
  const parsed = await parseJsonFromMessage(rawMessage);
  const items = toItemsArray(parsed);
  const attributes = structuredItemsToAttributeMap(items);

  return { attributes, items, totalPrice: undefined, rawContent: rawMessage };
}

