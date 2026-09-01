import type { Express, Request, Response } from "express";
import express from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { putObjectAtKey } from "../../media-upload";

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. PUT /objects/uploads/... - Client uploads file body directly
 * 3. GET /objects/... - Serve stored files (Yandex or local fallback)
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.put(
    /^\/objects\/(.+)$/,
    express.raw({ type: "*/*", limit: "100mb" }),
    async (req: Request, res: Response) => {
      try {
        const key = req.path.replace(/^\/objects\//, "");
        if (!key.startsWith("uploads/")) {
          return res.status(403).json({ error: "Forbidden path" });
        }
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        if (!body.length) {
          return res.status(400).json({ error: "Empty body" });
        }
        const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
        await putObjectAtKey(key, body, contentType);
        res.status(200).send();
      } catch (error: any) {
        console.error("Error storing uploaded object:", error);
        res.status(500).json({ error: error?.message || "Failed to store object" });
      }
    },
  );

  app.get(/^\/objects\/(.+)$/, async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res, 3600, req);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
