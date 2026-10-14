import { ApiError } from "../utils/ApiError.js";

/**
 * Middleware to restrict subadmins to only their permitted modules.
 * Superadmins and full Admins bypass this check unconditionally.
 */
export const verifyAdminRbac = (req, res, next) => {
  const user = req.user;

  // If no user attached, continue
  if (!user) {
    return next();
  }

  // If not an admin userType, skip
  if (user.userType !== "Admin") {
    return next();
  }

  // 1. Superadmin and Full Admin bypass unconditionally
  const isFullAdmin =
    !user.role ||
    user.role === "admin" ||
    user.role === "superadmin" ||
    (Array.isArray(user.allowedModules) && user.allowedModules.includes("*"));

  if (isFullAdmin) {
    return next();
  }

  // 2. Subadmin Role Checks
  if (user.role === "subadmin") {
    const allowedModules = Array.isArray(user.allowedModules)
      ? user.allowedModules
      : [];

    // Clean path (strip query params if any in req.path)
    const cleanPath = (req.path || "").split("?")[0];

    // Base routes allowed for any subadmin to manage their account
    const commonPaths = ["/profile", "/change-password", "/logout"];
    if (commonPaths.some((p) => cleanPath === p || cleanPath.startsWith(p + "/"))) {
      return next();
    }

    // Blog Management Module
    if (allowedModules.includes("blogs")) {
      const blogPaths = ["/blogs", "/blog-request"];
      if (blogPaths.some((p) => cleanPath === p || cleanPath.startsWith(p + "/"))) {
        return next();
      }
    }

    // Any other admin endpoint is forbidden for this subadmin
    throw new ApiError(
      403,
      "Access denied. Your subadmin account does not have permission for this module."
    );
  }

  return next();
};
