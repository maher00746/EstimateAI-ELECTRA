import express, { NextFunction, Request, Response } from "express";
import path from "path";
import cors from "cors";
import { config } from "./config";
import estimatesRouter from "./routes/estimates";
import draftsRouter from "./routes/drafts";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/estimates", estimatesRouter);
app.use("/api/drafts", draftsRouter);
app.use("/files", express.static(path.resolve(config.staticDir)));

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

export default app;

