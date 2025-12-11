import OpenAI from "openai";
import { AttributeMap, AttributeValue } from "../../types/build";

let cachedClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

async function parseJsonFromMessage(message: string): Promise<Record<string, unknown>> {
  const jsonMatch = message.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("OpenAI response did not include JSON");
  }
  return JSON.parse(jsonMatch[0]);
}

function toAttributeMap(payload: unknown): AttributeMap {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    return Object.entries(payload).reduce<AttributeMap>((acc, [key, value]) => {
      if (value === null || value === undefined) return acc;

      // Check if value is an object with value and price properties
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const attrValue: AttributeValue = {
          value: String(obj.value || ""),
          price: obj.price ? String(obj.price) : undefined,
        };
        acc[key] = attrValue;
      } else {
        // Backward compatibility: if it's a string, just store it as is
        acc[key] = String(value);
      }
      return acc;
    }, {});
  }
  return {};
}

export async function extractAttributesWithOpenAI(
  rawText: string,
  fileName: string
): Promise<{ attributes: AttributeMap; totalPrice?: string }> {
  const trimmed = rawText.replace(/\s+/g, " ").slice(0, 32000);
  const prompt = `
You are a meticulous PC build analyst. Extract every attribute name, its value, and its individual price (if mentioned) from the document.
For each attribute, extract both the component description and its price if available.

Respond with a single JSON object like:
{
  "totalPrice": "$2,800.00",
  "attributes": {
    "CPU": {
      "value": "Intel i9-13900K",
      "price": "$589.99"
    },
    "GPU": {
      "value": "NVIDIA RTX 4090",
      "price": "$1,599.99"
    },
    "Memory": {
      "value": "32GB DDR5",
      "price": "$149.99"
    }
  }
}

Important:
- If a price for an attribute is not found in the document, omit the "price" field for that attribute
- Always include the "value" field for each attribute
- Extract prices exactly as they appear (with currency symbols and formatting)
- Omit attributes you cannot confidently extract
`;

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
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
    max_tokens: 4000, // Increased to handle large documents with many attributes
  });

  const choice = response.choices?.[0];
  const rawMessage = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason;

  // Check if the response was truncated
  if (finishReason === 'length') {
    throw new Error("The document is too large. OpenAI response was truncated. Please increase max_tokens or split the document.");
  }

  const parsed = await parseJsonFromMessage(rawMessage);
  const attributes = toAttributeMap(parsed["attributes"]);
  const totalPrice =
    typeof parsed["totalPrice"] === "string" ? parsed["totalPrice"] : undefined;

  return { attributes, totalPrice };
}

