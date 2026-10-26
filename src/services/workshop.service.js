import { ApiError } from "../utils/ApiError.js";
import workshopRepository from "../repository/workshop.repository.js";
import teacherRepository from "../repository/teacher.repository.js";
import eventRegistrationRepository from "../repository/eventRegistration.repository.js";
import {
  uploadImageToCloudinary,
  deleteFileFromCloudinary,
} from "../utils/s3Upload.js";
import { attachOfferToList, attachOfferToItem } from "../utils/offerUtils.js";

const WORKSHOPS_IMAGE_FOLDER = "workshops";

export const createWorkshop = async (data, adminId, file) => {
  const {
    title,
    description,
    teacherId,
    startTime,
    endTime,
    meetingLink,
    meetingPassword,
    price,
    maxParticipants,
    registrationStartTime,
    registrationEndTime,
    eventType,
  } = data;

  if (!title || !startTime || !endTime || !meetingLink) {
    throw new ApiError(400, "Missing required fields");
  }

  if (!registrationStartTime || !registrationEndTime) {
    throw new ApiError(400, "Registration times are required");
  }

  // Validate teacher exists if provided
  if (teacherId) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new ApiError(404, "Teacher not found");
    }
  }

  // Validate time ranges
  if (new Date(startTime) >= new Date(endTime)) {
    throw new ApiError(400, "End time must be after start time");
  }

  if (new Date(registrationStartTime) >= new Date(registrationEndTime)) {
    throw new ApiError(400, "Registration end time must be after start time");
  }

  if (new Date(registrationEndTime) > new Date(startTime)) {
    throw new ApiError(400, "Registration must end before event starts");
  }

  let imageUrl = null;
  if (file) {
    imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      WORKSHOPS_IMAGE_FOLDER,
      file.mimetype,
    );
  }

  return await workshopRepository.create({
    title,
    description,
    imageUrl,
    teacher: teacherId || null,
    startTime,
    endTime,
    meetingLink,
    meetingPassword: meetingPassword || null,
    price: price || 0,
    maxParticipants: maxParticipants || null,
    registrationStartTime,
    registrationEndTime,
    eventType: eventType || "workshop",
    isPublished: data.isPublished === true || data.isPublished === "true",
    createdBy: adminId,
  });
};

/** Valid status values for server-side filtering. */
const VALID_STATUSES = ["close", "closed", "open", "upcoming", "live", "completed"];

const buildStatusQuery = (status) => {
  const now = new Date();
  switch (status) {
    case "close":
    case "closed":
      return {
        registrationStartTime: { $gt: now },
        startTime: { $gt: now },
      };
    case "open":
      return {
        $and: [
          { registrationStartTime: { $lte: now } },
          { registrationEndTime: { $gte: now } },
        ],
      };
    case "upcoming":
      return {
        registrationEndTime: { $lt: now },
        startTime: { $gt: now },
      };
    case "live":
      return {
        startTime: { $lte: now },
        endTime: { $gte: now },
      };
    case "completed":
      return { endTime: { $lt: now } };
    default:
      return null;
  }
};

export const getWorkshops = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    isPublished,
    eventType,
    teacherId,
    status,
  } = options;

  const query = {};
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  if (isPublished !== undefined) {
    query.isPublished = isPublished === "true" || isPublished === true;
  }
  if (eventType) {
    query.eventType = eventType;
  }
  if (teacherId) {
    query.teacher = teacherId;
  }
  const rawStatus =
    typeof status === "string" ? status.trim().toLowerCase() : null;
  const normalizedStatus = rawStatus === "closed" ? "close" : rawStatus;
  if (normalizedStatus && VALID_STATUSES.includes(normalizedStatus)) {
    const statusQuery = buildStatusQuery(normalizedStatus);
    if (statusQuery) Object.assign(query, statusQuery);
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const [workshops, total] = await Promise.all([
    workshopRepository.find(query, {
      populate: [
        { path: "teacher", select: "name email skills" },
        { path: "createdBy", select: "name email" },
      ],
      sort: { createdAt: -1 },
      skip,
      limit: limitNum,
    }),
    workshopRepository.count(query),
  ]);

  const workshopsWithOffer = await attachOfferToList(
    workshops,
    "Workshop",
    "price",
  );

  // Attach purchasedCount to each workshop so the frontend can lock edit/delete
  const workshopsWithPurchaseCount = await Promise.all(
    workshopsWithOffer.map(async (ws) => {
      const wsObj = ws?.toObject ? ws.toObject() : { ...ws };
      const purchasedCount = await eventRegistrationRepository.count({
        eventType: "workshop",
        eventId: wsObj._id,
        paymentStatus: "completed",
      });
      return { ...wsObj, purchasedCount };
    })
  );

  return {
    workshops: workshopsWithPurchaseCount,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

export const getWorkshopById = async (id) => {
  const workshop = await workshopRepository.findById(id, [
    { path: "teacher", select: "name email skills perMinuteRate" },
    { path: "createdBy", select: "name email" },
  ]);

  if (!workshop) {
    throw new ApiError(404, "Workshop not found");
  }
  return await attachOfferToItem(workshop, "Workshop", "price");
};

export const updateWorkshop = async (id, updateData, file) => {
  const workshop = await workshopRepository.findById(id);
  if (!workshop) {
    throw new ApiError(404, "Workshop not found");
  }

  if (file) {
    if (workshop.imageUrl) {
      await deleteFileFromCloudinary(workshop.imageUrl);
    }
    updateData.imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      WORKSHOPS_IMAGE_FOLDER,
      file.mimetype,
    );
  }

  // Validate teacher if provided
  if (updateData.teacherId) {
    const teacher = await teacherRepository.findById(updateData.teacherId);
    if (!teacher) {
      throw new ApiError(404, "Teacher not found");
    }
    updateData.teacher = updateData.teacherId;
    delete updateData.teacherId;
  }

  // Validate time ranges if provided
  if (updateData.startTime && updateData.endTime) {
    if (new Date(updateData.startTime) >= new Date(updateData.endTime)) {
      throw new ApiError(400, "End time must be after start time");
    }
  }

  return await workshopRepository.updateById(id, updateData);
};

export const deleteWorkshop = async (id) => {
  const workshop = await workshopRepository.findById(id);
  if (!workshop) {
    throw new ApiError(404, "Workshop not found");
  }

  if (workshop.imageUrl) {
    await deleteFileFromCloudinary(workshop.imageUrl);
  }
  return await workshopRepository.deleteById(id);
};

export default {
  createWorkshop,
  getWorkshops,
  getWorkshopById,
  updateWorkshop,
  deleteWorkshop,
};
