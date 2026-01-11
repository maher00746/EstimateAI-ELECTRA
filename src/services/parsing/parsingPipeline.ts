import path from "path";
import fs from "fs/promises";
import { extractTextFromDocx, extractTextFromPdf, extractTextFromTxt } from "./textExtractor";
import { AttributeMap, ExtractedItem } from "../../types/build";
import { extractAttributesFromPdfWithGemini, extractAttributesWithOpenAI } from "./openaiExtractor";

export async function parseDocument(
  filePath: string,
  options?: { includeRawContent?: boolean }
): Promise<{
  attributes: AttributeMap;
  items: ExtractedItem[];
  totalPrice?: string;
  rawContent?: string;
}> {
  const extension = path.extname(filePath).toLowerCase();
  let rawText = "";

  // PDFs are treated as drawings/renders: use a multimodal model with the PDF bytes.
  if (extension === ".pdf") {
    const pdfBuffer = await fs.readFile(filePath);
    const result = await extractAttributesFromPdfWithGemini(pdfBuffer, path.basename(filePath));
    if (!result.attributes || Object.keys(result.attributes).length === 0) {
      throw new Error("Failed to extract attributes from the PDF");
    }
    return {
      attributes: result.attributes,
      items: result.items,
      totalPrice: result.totalPrice,
      rawContent: options?.includeRawContent ? result.rawContent : undefined,
    };
  } else if (extension === ".docx") {
    rawText = await extractTextFromDocx(filePath);
  } else if (extension === ".txt") {
    rawText = await extractTextFromTxt(filePath);
  } else {
    rawText = await fs.readFile(filePath, "utf-8");
  }

  // Use ONLY OpenAI to extract attributes with prices
  const openAIResult = await extractAttributesWithOpenAI(rawText, path.basename(filePath));

  if (!openAIResult.attributes || Object.keys(openAIResult.attributes).length === 0) {
    throw new Error("Failed to extract attributes from the document");
  }

  return {
    attributes: openAIResult.attributes,
    items: openAIResult.items,
    totalPrice: openAIResult.totalPrice,
    rawContent: options?.includeRawContent ? openAIResult.rawContent : undefined,
  };
}

