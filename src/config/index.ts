import dotenv from "dotenv";
import path from "path";

dotenv.config();

const rootDir = path.resolve(__dirname, "..", "..");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/estimateai",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? path.join(rootDir, "uploads", "raw")),
  staticDir: path.resolve(process.env.STATIC_DIR ?? path.join(rootDir, "uploads", "raw")),
  maxFileSize: 60 * 1024 * 1024, // 60MB per file
  openAiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: "gpt-5.2",
  airweaveBaseUrl: (process.env.AIRWEAVE_BASE_URL ?? "https://api.airweave.ai").replace(/\/+$/, ""),
  airweaveApiKey: process.env.AIRWEAVE_API_KEY ?? "",
  airweaveCollectionId: process.env.AIRWEAVE_COLLECTION_ID ?? "",
  airweaveOrganizationId: process.env.AIRWEAVE_ORGANIZATION_ID ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "your-secret-key-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
};

