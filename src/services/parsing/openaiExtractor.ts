import { config } from "../../config";
import { AttributeMap, ExtractedItem } from "../../types/build";
import { getOpenAiClient } from "../openai/client";

async function parseJsonFromMessage(message: string): Promise<unknown> {
  const arrayMatch = message.match(/\[[\s\S]*\]/);
  const objectMatch = message.match(/\{[\s\S]*\}/);
  const jsonMatch = arrayMatch?.[0] ?? objectMatch?.[0];
  if (!jsonMatch) {
    throw new Error("OpenAI response did not include JSON");
  }
  return JSON.parse(jsonMatch);
}

function toItemsArray(payload: unknown): ExtractedItem[] {
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
): Promise<{ attributes: AttributeMap; items: ExtractedItem[]; totalPrice?: string }> {
  const trimmed = rawText.replace(/\s+/g, " ").slice(0, 32000);
  const prompt = `
You are a senior MEP estimator, in a company selling "Diesel Generators or Diesel-fired Boilers with the diesel fuel". Your task is to extract every measurable requirement, component and attribute from the supplied drawings and return them in a fully structured machine-readable format. Work carefully and exhaustively.

Scope

• Extract all mechanical, electrical, instrumentation items directly shown or tagged in the drawings.
• NO civil related items (like walls) 
• Capture every attribute including size, diameter, capacity, material, rating, quantity, notes and standards (UL, NFPA, ASTM etc).
• Include all Filling Point, Storage Tank, Pump, Day Tank, Piping, Valves (including BV and CV), Strainers, Leak Sensors, Level Probes (if any), Level Switches, Tank Vents, Master Control Panel, Overfill Alarm Units, Flexible Hoses, and Electrical Materials (Wiring and conduits).
• Count all occurrences of each labelled item (e.g., BV tags, CV tags, pipe diameters, vent sizes).
• Do not infer linear pipe lengths unless explicitly given.
• Do not omit any attribute.

Output format

Return a single JSON array where each item is an object with these fields:

{
  "item_number": "",
  "description": "",
  "capacity": "",
  "size": "",
  "quantity": "",
  "unit": "",
  "full_description": ""
}



Objective
Provide a complete, accurate, structured extraction suitable for programmatic use in pricing, BOQ generation or database ingestion.
`;

  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: config.openAiModel,
    messages: [
      {
        role: "system",
        content:
          "You are a rules-aware parser. Always return JSON, and never add explanatory prose outside the JSON.",
      },
      {
        role: "user",
        content: `${prompt}\n\nBuild document name: ${fileName}\n\n${trimmed}`,
      },
    ],
    temperature: 0.1,
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

  return { attributes, items, totalPrice: undefined };
}

