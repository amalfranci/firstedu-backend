import AiBankDraft from "../models/AiBankDraft.js";

/** Fetch the current user's draft (or null). */
const findByUser = (userId) => AiBankDraft.findOne({ user: userId }).lean();

/**
 * Upsert the user's single active draft.
 * Returns the saved document.
 */
const upsertByUser = (userId, { data, clientUpdatedAt }) =>
  AiBankDraft.findOneAndUpdate(
    { user: userId },
    { $set: { data, clientUpdatedAt: clientUpdatedAt ?? new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

/** Remove the user's draft (e.g. after a successful save/discard). */
const deleteByUser = (userId) => AiBankDraft.deleteOne({ user: userId });

export default { findByUser, upsertByUser, deleteByUser };
