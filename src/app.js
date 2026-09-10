import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import studentRoutes from "./routes/student.routes.js";
import landingPageRoutes from "./routes/landingPage.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import teacherRoutes from "./routes/teacher.routes.js";
import webhooksRoutes from "./routes/webhooks.routes.js";
import ApiError from "./utils/ApiError.js";
import { isCorsOriginAllowed } from "./utils/corsOrigin.js";

dotenv.config();
const app = express();

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS Warning: Origin ${origin} not allowed.`);
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

// app.use(cors());

app.use(cookieParser());

// Webhooks: raw body required for signature verification (must be before express.json)
app.use(
  "/webhooks/razorpay",
  express.raw({ type: "application/json", limit: "64kb" }),
  webhooksRoutes,
);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "2mb" }));

// Routes
app.use("/user", studentRoutes);
app.use("/admin", adminRoutes);
app.use("/teacher", teacherRoutes);
app.use("/landing-page", landingPageRoutes);
// Test Route
app.get("/test", (req, res) => {
  // Send it in the response
  res.json({
    success: true,
    message: `Server is working!!🚀`,
    timestamp: new Date().toISOString(),
  });
});

// Basic Error Handler
app.use((err, req, res, next) => {
  // JSON body too large (express.json / body-parser)
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: `Request body too large. Maximum JSON size is ${process.env.JSON_BODY_LIMIT || "2mb"}.`,
      data: null,
    });
  }

  // Handle multer file size errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "File too large. Maximum file size is 500MB",
      data: null,
    });
  }

  // Handle multer file type errors
  if (
    err.message &&
    (err.message.includes("video files") ||
      err.message.includes("Only video files"))
  ) {
    return res.status(400).json({
      success: false,
      message: err.message,
      data: null,
    });
  }

  // Handle multer "Unexpected field" error (wrong field name)
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    const fieldInfo = err.field ? ` (received '${err.field}')` : '';
    return res.status(400).json({
      success: false,
      message: `Invalid file upload field name${fieldInfo}. Please verify the correct field key expected by this API endpoint.`,
      data: null,
    });
  }

  // If it's an instance of ApiError → use its structure
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Otherwise, fallback to generic
  console.error("Unhandled Error:", err);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
    data: null,
  });
});

export default app;
