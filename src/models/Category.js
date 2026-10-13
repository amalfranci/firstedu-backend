import mongoose from "mongoose";

/**
 * Base Category Schema: Structural hierarchy only (Pillars & folders).
 * No business data — purely organizational.
 */
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: function () { return !this.isPredefined; },
    },
    isPredefined: {
      type: Boolean,
      default: false,
    },
      rootType: {
      type: String,
      enum: ["Competitive", "School", "Skill Development", "Olympiads", "Gamification", "custom"],
      default: "custom",
    },
    status: {
      type: String,
      enum: ["Draft", "Public"],
      default: "Draft",
    },
  },
  {
    timestamps: true,
    discriminatorKey: "kind",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

categorySchema.index({ parent: 1, order: 1 });
categorySchema.index({ name: 1 });
categorySchema.index({ createdBy: 1, createdAt: -1 });
categorySchema.index({ rootType: 1, isPredefined: 1 });
categorySchema.index({ isPredefined: 1 });

const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);

const subcategorySchema = new mongoose.Schema(
  {
    // ─── Content & Media ────────────────────────────────
    description: { type: String, trim: true, default: null },
    syllabus: { type: String, trim: true, default: null },

    // ─── Classification ─────────────────────────────────
    subjects: { type: [String], default: [] },
    /* @deprecated – no longer accepted via API. Field kept to preserve legacy data. */
    tags: { type: [String], default: [] },

    // ─── Capacity ────────────────────────────────────────
    capacity: { type: Number, default: null, min: 1 },

    // ─── Pricing ─────────────────────────────────────────
    price: { type: Number, default: 0, min: 0 },
    discountedPrice: { type: Number, default: null, min: 0 },
    isFree: { type: Boolean, default: false },

    // ─── Publishing ──────────────────────────────────────
    status: { type: String, enum: ["Draft", "Public"], default: "Draft" },

    offerPolicy: {
      type: String,
      enum: ["inherit", "none", "custom"],
      default: "inherit",
    },
    couponPolicy: {
      type: String,
      enum: ["inherit", "none", "custom"],
      default: "inherit",
    },
    offerOverrideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },

    // ─── Engagement ──────────────────────────────────────
    purchaseCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

subcategorySchema.index({ status: 1 });

subcategorySchema.virtual("effectivePrice").get(function () {
  if (this.isFree) return 0;
  return this.discountedPrice !== null && this.discountedPrice !== undefined
    ? this.discountedPrice
    : this.price;
});

subcategorySchema.virtual("hasPurchase").get(function () {
  return this.purchaseCount > 0;
});

export const Subcategory =
  Category.discriminators?.Subcategory ||
  Category.discriminator("Subcategory", subcategorySchema);

export default Category;
