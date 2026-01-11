import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../../config";

let geminiClient: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    geminiClient = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return geminiClient;
}

