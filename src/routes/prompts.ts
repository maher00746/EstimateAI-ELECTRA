import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getPromptByKey, upsertPrompt } from "../modules/storage/promptRepository";
import {
  DRAWING_CATEGORIES,
  DRAWING_EXTRACTION_PROMPT,
  DrawingCategoryKey,
  DRAWING_CATEGORY_PROMPT_DEFAULTS,
  getDrawingExtractionPrompt,
} from "../services/parsing/openaiExtractor";

const router = Router();
const DRAWING_PROMPT_KEY = "drawing-extraction";

function buildCategoryKey(key: DrawingCategoryKey) {
  return `drawing-${key}-extraction`;
}

async function loadCategoryPrompt(key: DrawingCategoryKey) {
  const stored = await getPromptByKey(buildCategoryKey(key));
  const base = DRAWING_CATEGORY_PROMPT_DEFAULTS[key] ?? "";
  const storedContent = stored?.content ?? "";
  const prompt = storedContent.trim().length > 0 ? storedContent : base;
  const isDefault = storedContent.trim().length === 0;
  return {
    prompt,
    updatedAt: stored?.updatedAt ?? null,
    isDefault,
  };
}

router.get("/drawing-extraction", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stored = await getPromptByKey(DRAWING_PROMPT_KEY);
    const prompt = stored?.content?.trim() ? stored.content : DRAWING_EXTRACTION_PROMPT;

    const categoriesEntries = await Promise.all(
      DRAWING_CATEGORIES.map(async ({ key }) => [key, await loadCategoryPrompt(key)])
    );
    const categories = Object.fromEntries(categoriesEntries);

    res.status(200).json({
      key: DRAWING_PROMPT_KEY,
      prompt,
      updatedAt: stored?.updatedAt ?? null,
      isDefault: !stored,
      categories,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/drawing-extraction", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, categories } = req.body ?? {};

    const hasPromptUpdate = typeof prompt === "string";
    const hasCategoriesUpdate = categories && typeof categories === "object";

    if (!hasPromptUpdate && !hasCategoriesUpdate) {
      return res.status(400).json({ message: "prompt or categories is required" });
    }

    if (hasPromptUpdate) {
      if (!prompt.trim()) {
        return res.status(400).json({ message: "prompt is required" });
      }
      await upsertPrompt(DRAWING_PROMPT_KEY, prompt);
    }

    if (hasCategoriesUpdate) {
      for (const { key } of DRAWING_CATEGORIES) {
        const value = categories[key];
        if (value === undefined) continue;
        if (typeof value !== "string") {
          return res.status(400).json({ message: `categories.${key} must be a string` });
        }
        await upsertPrompt(buildCategoryKey(key), value);
      }
    }

    const stored = await getPromptByKey(DRAWING_PROMPT_KEY);
    const resolvedPrompt = stored?.content?.trim() ? stored.content : DRAWING_EXTRACTION_PROMPT;
    const categoriesEntries = await Promise.all(
      DRAWING_CATEGORIES.map(async ({ key }) => [key, await loadCategoryPrompt(key)])
    );
    const categoriesResponse = Object.fromEntries(categoriesEntries);

    res.status(200).json({
      key: DRAWING_PROMPT_KEY,
      prompt: resolvedPrompt,
      updatedAt: stored?.updatedAt ?? null,
      isDefault: !stored,
      categories: categoriesResponse,
    });
  } catch (error) {
    next(error);
  }
});

export default router;


