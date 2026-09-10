import Joi from "joi";

const createCarearJob = Joi.object({
  title: Joi.string().trim().required().messages({
    "string.empty": "Job title is required.",
    "any.required": "Job title is required.",
  }),

  description: Joi.string().trim().required().messages({
    "string.empty": "Job description is required.",
    "any.required": "Job description is required.",
  }),

  company: Joi.string().trim().required().messages({
    "string.empty": "Company name is required.",
    "any.required": "Company name is required.",
  }),

  location: Joi.string().trim().allow("").optional(),

  type: Joi.string().trim().required().messages({
    "string.empty": "Job type is required (e.g. Full-time, Part-time, Internship).",
    "any.required": "Job type is required (e.g. Full-time, Part-time, Internship).",
  }),

  category: Joi.string().valid("iscorre", "general").required().messages({
    "string.empty": "Category is required.",
    "any.required": "Category is required.",
    "any.only": "Category must be one of: TestLadr, general.",
  }),

  // Optional fields
  skills: Joi.array().items(Joi.string().trim()).default([]),

  experience: Joi.string().trim().allow("").optional(),

  salary: Joi.object({
    min: Joi.number().min(0).optional().allow(null).messages({
      "number.min": "Minimum salary must be at least 0.",
    }),
    max: Joi.number().min(0).optional().allow(null).messages({
      "number.min": "Maximum salary must be at least 0.",
    }),
  }).optional(),

  mode: Joi.string().trim().allow("").optional(),

  openings: Joi.number().integer().min(1).optional().messages({
    "number.min": "Openings must be at least 1.",
    "number.integer": "Openings must be a whole number.",
  }),

  deadline: Joi.date().iso().allow(null).optional().messages({
    "date.format": "Deadline must be a valid ISO date (e.g. 2025-12-31).",
  }),

  redirectLink: Joi.string().uri().allow("").optional().messages({
    "string.uri": "Redirect link must be a valid URL.",
  }),
});

const updateCarearJob = Joi.object({
  title: Joi.string().trim().optional().messages({
    "string.empty": "Job title cannot be empty.",
  }),

  description: Joi.string().trim().optional().messages({
    "string.empty": "Job description cannot be empty.",
  }),

  company: Joi.string().trim().optional().messages({
    "string.empty": "Company name cannot be empty.",
  }),

  location: Joi.string().trim().allow("").optional(),

  type: Joi.string().trim().allow("").optional(),

  category: Joi.string().valid("iscorre", "general").optional().messages({
    "any.only": "Category must be one of: TestLadr, general.",
  }),

  skills: Joi.array().items(Joi.string().trim()).optional(),

  experience: Joi.string().trim().allow("").optional(),

  salary: Joi.object({
    min: Joi.number().min(0).optional().allow(null).messages({
      "number.min": "Minimum salary must be at least 0.",
    }),
    max: Joi.number().min(0).optional().allow(null).messages({
      "number.min": "Maximum salary must be at least 0.",
    }),
  }).optional(),

  mode: Joi.string().trim().allow("").optional(),

  openings: Joi.number().integer().min(1).optional().messages({
    "number.min": "Openings must be at least 1.",
    "number.integer": "Openings must be a whole number.",
  }),

  deadline: Joi.date().iso().allow(null).optional().messages({
    "date.format": "Deadline must be a valid ISO date (e.g. 2025-12-31).",
  }),

  redirectLink: Joi.string().uri().allow("").optional().messages({
    "string.uri": "Redirect link must be a valid URL.",
  }),
}).min(1).messages({
  "object.min": "At least one field must be provided to update the job.",
});

export default {
  createCarearJob,
  updateCarearJob,
};
