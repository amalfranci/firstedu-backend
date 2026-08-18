import mongoose from "mongoose";

/**
 * AiBankDraft
 * -----------
 * A single in-progress "AI Powered Test" create-flow snapshot per user.
 * Autosaved from the admin frontend so work survives a refresh / tab close /
 * device switch and the user can resume where they left off.
 *
 * Stored in its own collection ("ai_bank_drafts") on the main connection.
 * `data` holds the opaque create-form state blob owned by the frontend, so the
 * backend does not need to change when the form's shape evolves.
 */
const aiBankDraftSchema = new mongoose.Schema(
  {
    // One active draft per user (upserted on autosave).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    // Full create-form snapshot (bankName, sections, questions, etc.).
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Client-supplied timestamp used for last-write-wins reconciliation.
    clientUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, collection: "ai_bank_drafts", minimize: false }
);

export default mongoose.models.AiBankDraft ||
  mongoose.model("AiBankDraft", aiBankDraftSchema);
