import { ExtractedItem } from "../../types/build";
import { getOpenAiClient } from "./client";
import { loadPriceList, PriceListRow } from "../pricing/priceList";

export interface PriceMapping {
    item_index: number;
    price_list_index: number;
    unit_price?: string | number;
    unit_manhour?: string | number;
    price_row?: PriceListRow;
    match_reason?: string;
    note?: string;
}

interface PriceMappingResponse {
    mappings: PriceMapping[];
    rawContent: string;
}

function parseMappings(content: string): PriceMapping[] {
    const tryParse = (text: string): PriceMapping[] => {
        try {
            const parsed = JSON.parse(text);
            const payload = Array.isArray(parsed)
                ? { mappings: parsed }
                : parsed && typeof parsed === "object"
                    ? parsed
                    : {};
            const mappingsRaw = (payload as any).mappings;
            if (!Array.isArray(mappingsRaw)) return [];
            return mappingsRaw
                .map((m: any) => ({
                    item_index: m.item_index,
                    price_list_index: m.price_list_index,
                    unit_price: m.unit_price,
                    unit_manhour: m.unit_manhour,
                    match_reason: m.match_reason,
                    note: m.note,
                }))
                .filter((m: any) =>
                    typeof m.item_index === "number" &&
                    typeof m.price_list_index === "number" &&
                    m.item_index >= 0 &&
                    m.price_list_index >= 0
                );
        } catch {
            return [];
        }
    };

    const direct = tryParse(content);
    if (direct.length) return direct;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        const fallback = tryParse(jsonMatch[0]);
        if (fallback.length) return fallback;
    }

    return [];
}

// Standard inch-to-mm conversion for MEP piping (nominal pipe sizes)
const INCH_TO_MM: Record<string, number> = {
    "0.5": 15, "1/2": 15,
    "0.75": 20, "3/4": 20,
    "1": 25,
    "1.25": 32, "1-1/4": 32,
    "1.5": 40, "1-1/2": 40,
    "2": 50,
    "2.5": 65, "2-1/2": 65,
    "3": 80,
    "4": 100,
    "5": 125,
    "6": 150,
    "8": 200,
    "10": 250,
    "12": 300,
};

function normalizeSize(size?: string): string {
    if (!size) return "";
    const lower = size.toLowerCase().trim();

    // Already in mm - extract and return
    const mmMatch = lower.match(/(\d+)\s*mm/i);
    if (mmMatch) return `${mmMatch[1]}mm`;

    // Handle various inch formats: 3", Ø3", 3 inch, 3in, DN3
    const inchPatterns = [
        /(?:ø|Ø|DN)?(\d+(?:[.-]\d+\/\d+)?|\d+\/\d+)\s*(?:"|''|inch|in)\b/i,
        /(?:ø|Ø|DN)(\d+(?:\.\d+)?)\b/i,
    ];

    for (const pattern of inchPatterns) {
        const match = lower.match(pattern);
        if (match) {
            const inchVal = match[1].replace("-", ".");
            const mm = INCH_TO_MM[inchVal];
            if (mm) return `${mm}mm`;
        }
    }

    // Try direct numeric extraction for simple cases like "3" or "4"
    const numMatch = size.match(/^(\d+(?:\.\d+)?)\s*$/);
    if (numMatch) {
        const mm = INCH_TO_MM[numMatch[1]];
        if (mm) return `${mm}mm`;
    }

    return size;
}

function categorizeItem(item: ExtractedItem): string {
    const desc = (item.description ?? item.full_description ?? "").toLowerCase();
    const itemType = (item.item_type ?? "").toLowerCase();

    if (desc.includes("storage tank") || itemType.includes("storage tank")) return "STORAGE_TANK";
    if (desc.includes("day tank") || itemType.includes("day tank")) return "DAY_TANK";
    if (desc.includes("pump") || itemType.includes("pump")) return "PUMP";
    if (desc.includes("filling point") || desc.includes("fill point")) return "FILLING_POINT";
    if (desc.match(/\bbv\b/) || desc.includes("ball valve")) return "BALL_VALVE";
    if (desc.match(/\bcv\b/) || desc.includes("check valve")) return "CHECK_VALVE";
    if (desc.includes("gate valve")) return "GATE_VALVE";
    if (desc.includes("strainer")) return "STRAINER";
    if (desc.includes("pipe") || desc.includes("piping")) return "PIPE";
    if (desc.includes("flexible") || desc.includes("hose")) return "FLEXIBLE_HOSE";
    if (desc.includes("vent")) return "VENT";
    if (desc.includes("leak") || desc.includes("sensor")) return "SENSOR";
    if (desc.includes("level") && (desc.includes("probe") || desc.includes("switch") || desc.includes("indicator"))) return "LEVEL_DEVICE";
    if (desc.includes("control panel") || desc.includes("mcp")) return "CONTROL_PANEL";
    if (desc.includes("conduit") || desc.includes("wiring") || desc.includes("cable")) return "ELECTRICAL";

    return "OTHER";
}

function buildPrompt(items: ExtractedItem[], priceList: PriceListRow[]): string {
    // Build simplified items with category and normalized fields
    const itemsForModel = items.map((item, idx) => {
        const normalizedSize = normalizeSize(item.size);
        const category = categorizeItem(item);
        return {
            idx,
            category,
            description: (item.description ?? item.full_description ?? "").trim(),
            size: normalizedSize || item.size || "",
            capacity: item.capacity || "",
            quantity: item.quantity || "",
        };
    });

    // Simplify price list - only include relevant columns
    const priceListForModel = priceList.map((row, idx) => {
        const simplified: Record<string, string | number> = { idx };
        for (const [key, value] of Object.entries(row)) {
            // Include description/item columns and price/manhour columns
            const lowerKey = key.toLowerCase();
            if (
                lowerKey.includes("description") ||
                lowerKey.includes("item") ||
                lowerKey.includes("size") ||
                lowerKey.includes("capacity") ||
                lowerKey.includes("price") ||
                lowerKey.includes("manhour") ||
                lowerKey.includes("man hour") ||
                lowerKey.includes("unit")
            ) {
                simplified[key] = value;
            }
        }
        return simplified;
    });

    console.log("[price-map] prompt itemsForModel:", itemsForModel);
    console.log("[price-map] prompt priceListForModel (truncated):", priceListForModel.slice(0, 5));

    return `
You are a senior MEP estimator specializing in fuel systems. Your task is to map estimate items to the correct rows in a price list.

## SIZE CONVERSION REFERENCE
Standard inch to mm conversions (CRITICAL - use these exact values):
| Inch | mm |
|------|-----|
| 1/2" | 15mm |
| 3/4" | 20mm |
| 1"   | 25mm |
| 1-1/4" | 32mm |
| 1-1/2" | 40mm |
| 2"   | 50mm |
| 2-1/2" | 65mm |
| 3"   | 80mm |
| 4"   | 100mm |
| 5"   | 125mm |
| 6"   | 150mm |
| 8"   | 200mm |
| 10"  | 250mm |
| 12"  | 300mm |

## MATCHING RULES BY CATEGORY

**STORAGE_TANK / DAY_TANK:**
- Match by EXACT capacity (e.g., 10000L, 500 Gal)
- match by type of tank (day/storage).
- Return ALL price list rows for that tank type with matching capacity and type of tank

**PUMP:**
- Match by GPM or LPM rating from description/capacity
- Also consider PSI if specified
- Return ALL matching pump entries

**BALL_VALVE (BV) / CHECK_VALVE (CV) / GATE_VALVE:**
- Match by SIZE (in mm after conversion)
- 3" = 80mm, 4" = 100mm, 1" = 25mm, 2"  = 50mm etc.
- Return ALL valves of that type with matching size

**PIPE / PIPING:**
- Match by SIZE (in mm) and material type if specified
- Return ALL matching pipe entries for that size

**STRAINER / FLEXIBLE_HOSE / VENT:**
- Match by SIZE (in mm)

**EMERGENCY_VENT:**
- return ALL emergency vents with the same size.
- Match by SIZE (in mm)

**LEVEL INDICATOR**
- if the tank type is provided, then return all level indicators for that tank type, if not specified, return all level indicators.

**OTHER items:**
- Match by semantic similarity in description
- Consider size/capacity if present



## INPUT DATA

Items to price:
${JSON.stringify(itemsForModel, null, 1)}

Price list (idx is zero-based):
${JSON.stringify(priceListForModel, null, 1)}

## OUTPUT FORMAT

Return ONLY valid JSON in this exact structure:
{
  "mappings": [
    {
      "item_index": <zero-based index from items>,
      "price_list_index": <zero-based index from price list>,
      "unit_price": <exact value from price list row>,
      "unit_manhour": <exact value from price list row>,
      "match_reason": "<brief explanation>"
    }
  ]
}

## IMPORTANT RULES
1. Return MULTIPLE mappings per item if multiple price list rows match, Make sure you checked all the price list rows for the item.
2. Copy unit_price and unit_manhour EXACTLY as they appear in the price list row
3. Only include confident matches - omit items with no good match
4. Use zero-based indices
5. Do NOT include any text outside the JSON
6. If you find match, continue for the rest of pricing list tems for make sure that all matches are found.
`.trim();
}

export async function mapItemsToPriceList(
    items: ExtractedItem[]
): Promise<PriceMappingResponse> {
    const priceList = await loadPriceList({ cleanHeaders: false });
    const prompt = buildPrompt(items, priceList);
    console.log("[price-map] items payload:", items);
    console.log("[price-map] prompt length:", prompt.length);

    const client = getOpenAiClient();

    const systemPrompt = `You are an expert MEP (Mechanical, Electrical, Plumbing) estimator with deep knowledge of fuel systems, piping, valves, tanks, and pumps.

Your task is to accurately match estimate items to the correct price list entries.

Key expertise:
- Understand that pipe sizes are often in inches (1", 2", 3", etc.) and must be converted to mm
- Know that BV = Ball Valve, CV = Check Valve
- Recognize tank capacities in Liters, Gallons, or cubic meters
- Match pumps by flow rate (GPM/LPM) and pressure (PSI/bar)

Be thorough: check EVERY price list row for potential matches.
Be precise: only return confident matches with exact price values.
Return valid JSON only.`;

    const response = await client.chat.completions.create({
        model: "gpt-5.2",
        temperature: 0,
        max_completion_tokens: 16000,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
    });

    console.log("[price-map] OpenAI model used:", response.model);
    console.log("[price-map] OpenAI usage:", response.usage);

    const content = response.choices?.[0]?.message?.content ?? "";
    console.log("[price-map] OpenAI content length:", content.length);

    const rawMappings = parseMappings(content);
    const mappings: PriceMapping[] = [];

    for (const mapping of rawMappings) {
        // Validate price_list_index is within bounds
        if (mapping.price_list_index >= priceList.length || mapping.price_list_index < 0) {
            console.warn(`[price-map] Invalid price_list_index ${mapping.price_list_index}, max is ${priceList.length - 1}`);
            continue;
        }
        mappings.push({
            ...mapping,
            price_row: priceList[mapping.price_list_index],
        });
    }

    console.log("[price-map] Total mappings found:", mappings.length);

    return { mappings, rawContent: content };
}


