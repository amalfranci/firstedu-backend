import aiBankDraftRepository from "../repository/aiBankDraft.repository.js";

/** Get the current user's saved draft (null when none). */
const getDraft = async (userId) => {
  return aiBankDraftRepository.findByUser(userId);
};

/** Create/update the user's single active draft. */
const saveDraft = async (userId, { data, clientUpdatedAt }) => {
  return aiBankDraftRepository.upsertByUser(userId, {
    data: data ?? {},
    clientUpdatedAt: clientUpdatedAt ? new Date(clientUpdatedAt) : undefined,
  });
};

/** Delete the user's draft. Idempotent. */
const deleteDraft = async (userId) => {
  await aiBankDraftRepository.deleteByUser(userId);
  return { deleted: true };
};

export default { getDraft, saveDraft, deleteDraft };
