import Joi from "joi";

// Recursive schema: each category can have optional nested children (unlimited depth)
const createCategorySchema = Joi.object({
  name: Joi.string().required().trim(),
  parent: Joi.string().optional().allow(null, ""),
  order: Joi.number().min(0).optional(),
  rootType: Joi.string()
    .valid("School", "Competitive", "Olympiads", "Skill Development", "Gamification", "custom")
    .optional(),
  gamificationType: Joi.string()
    .valid("challenge_yourself", "challenge_your_friend", "base_pillar")
    .optional(),
  isPredefined: Joi.boolean().optional(),
  status: Joi.string().valid("Draft", "Public").optional(),
  children: Joi.array().items(Joi.link("#category")).optional(),
}).id("category");

const createCategory = createCategorySchema;

const updateCategory = Joi.object({
  name: Joi.string().trim().optional(),
  parent: Joi.string().optional().allow(null, ""),
  order: Joi.number().min(0).optional(),
  isActive: Joi.boolean().optional(),
  status: Joi.string().valid("Draft", "Public").optional(),
  rootType: Joi.string()
    .valid("School", "Competitive", "Olympiads", "Skill Development", "Gamification", "custom")
    .optional(),
  gamificationType: Joi.string()
    .valid("challenge_yourself", "challenge_your_friend", "base_pillar")
    .optional(),
  isPredefined: Joi.boolean().optional(),
});

/**
 * Subcategory details/pricing form.
 * All fields are strictly optional — no field is required.
 */
const updateCategoryPricing = Joi.object({
  // Pricing
  price:           Joi.number().min(0).precision(2).optional(),
  discountedPrice: Joi.number().min(0).precision(2).allow(null).optional(),
  isFree:          Joi.boolean().optional(),
  status:          Joi.string().valid("Draft", "Public").optional(),

  // Policy
  offerPolicy:     Joi.string().valid("inherit", "none", "custom").optional(),
  couponPolicy:    Joi.string().valid("inherit", "none", "custom").optional(),
  offerOverrideId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow(null, "").optional(),

  // Content
  description:         Joi.string().trim().allow("", null).optional(),
  syllabus:            Joi.string().trim().allow("", null).optional(),

  // Media
  bannerImg: Joi.string().trim().allow("", null).optional(),

  // Classification (subjects is read-only, derived from children — not accepted here)
  // tags removed: no longer exposed via API

  // Capacity
  capacity: Joi.number().min(1).allow(null).optional(),
});

export default {
  createCategory,
  updateCategory,
  updateCategoryPricing,
};
