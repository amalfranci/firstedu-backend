import Joi from "joi";

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const bankDetails = Joi.object({
  accountHolderName: Joi.string().trim().min(2).max(120).required(),
  accountNumber: Joi.string()
    .trim()
    .pattern(/^([0-9]{9,18}|\*{4}[0-9]{4}|\*+)$/)
    .required()
    .messages({
      "string.pattern.base": "Account number must be 9–18 digits",
    }),
  bankName: Joi.string().trim().min(2).max(120).required(),
  ifscCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(IFSC_PATTERN)
    .required()
    .messages({
      "string.pattern.base": "Invalid IFSC code (use 11 characters, e.g. SBIN0001234)",
    }),
});

const withdrawalAmount = Joi.object({
  amount: Joi.number().integer().min(100).required(),
});

export default {
  bankDetails,
  withdrawalAmount,
};
