import ExamDeskUser from "../models/ExamDeskUser.js";

export const EXAM_DESK_SEED_USERS = [
  { username: "rahul", userId: "rahul" },
  { username: "priya", userId: "priya" },
  { username: "ananya", userId: "ananya" },
  { username: "arjun", userId: "arjun" },
  { username: "demo", userId: "demo" },
];

export const toExamDeskUserId = (username) =>
  String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const seedExamDeskUsers = async ({ replace = false } = {}) => {
  if (replace) {
    await ExamDeskUser.deleteMany({});
  }
  const results = [];
  for (const item of EXAM_DESK_SEED_USERS) {
    const user = await ExamDeskUser.findOneAndUpdate(
      { userId: item.userId },
      {
        $set: {
          userId: item.userId,
          username: item.username,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push({ userId: user.userId, username: user.username });
  }
  console.log(`Seeded ${results.length} exam desk usernames.`);
  return { seeded: true, users: results };
};
