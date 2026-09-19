/**
 * Frontend injects synthetic "All subjects" leaves as `${examObjectId}::__all_subjects`.
 * Those are not Mongo Category docs — persist / look up the parent exam id instead.
 */
const ALL_SUBJECTS_SUFFIX = /::__all_subjects$/i;

export const normalizeCategoryId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.replace(ALL_SUBJECTS_SUFFIX, "");
};

export const normalizeCategoryIds = (ids = []) => {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    const next = normalizeCategoryId(id);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
};

export default normalizeCategoryIds;
