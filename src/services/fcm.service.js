import { admin as firebaseAdmin } from "../config/firebase.js";

const DEFAULT_WEB_PUSH_LINK = "https://admin.testladr.com/student/notifications";
const DEFAULT_WEB_PUSH_ICON = "https://admin.testladr.com/vite.svg";

const getWebPushLink = (data = {}) => { 
  const explicitLink = data.url || data.link || data.clickUrl || data.click_action;
  if (explicitLink) return String(explicitLink);

  const audience = data.audience;
  if (audience === 'teacher') {
    return process.env.TEACHER_APP_URL || 'https://admin.testladr.com/teacher/dashboard';
  }

  const configuredLink =
    process.env.FCM_WEB_PUSH_LINK ||
    process.env.STUDENT_APP_URL ||
    process.env.APP_FRONTEND_URL;
  if (configuredLink) return String(configuredLink);

  return DEFAULT_WEB_PUSH_LINK;
};

const buildWebPushConfig = (title, body, data = {}) => {
  const link = getWebPushLink(data);
  const icon = String(data.icon || process.env.FCM_WEB_PUSH_ICON || DEFAULT_WEB_PUSH_ICON);
  return {
    notification: {
      title,
      body,
      icon,
      badge: icon,
    },
    fcmOptions: {
      link,
    },
  };
};


/**
 * Send FCM notification to a single device
 * @param {string} fcmToken - FCM token of the recipient
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} - FCM response
 */
export const sendNotificationToDevice = async (fcmToken, title, body, data = {}) => {
  if (!firebaseAdmin) {
    throw new Error("Firebase Admin SDK not initialized");
  }

  if (!fcmToken) {
    throw new Error("FCM token is required");
  }

  const stringData = Object.fromEntries(
    Object.entries({
      ...data,
      title,
      body,
      timestamp: new Date().toISOString(),
    }).map(([k, v]) => [k, v != null ? String(v) : ''])
  );

  const message = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
    data: stringData,
    webpush: buildWebPushConfig(title, body, data),
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  };

  try {
    const response = await firebaseAdmin.messaging().send(message);
    console.log("✅ Successfully sent FCM notification:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ Error sending FCM notification:", error);
    
    // Handle invalid token errors
    if (error.code === "messaging/invalid-registration-token" || 
        error.code === "messaging/registration-token-not-registered") {
      return { success: false, error: "invalid_token", message: error.message };
    }
    
    throw error;
  }
};

/**
 * Send FCM data-only message to a single device (no notification popup).
 * Use for silent events like FORCE_LOGOUT so the app can clear local session.
 * @param {string} fcmToken - FCM token of the recipient
 * @param {object} data - Data payload (all values must be strings for FCM)
 * @returns {Promise<object>} - FCM response
 */
export const sendDataOnlyToDevice = async (fcmToken, data = {}) => {
  if (!firebaseAdmin) {
    throw new Error("Firebase Admin SDK not initialized");
  }
  if (!fcmToken) {
    throw new Error("FCM token is required");
  }
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );
  const message = {
    token: fcmToken,
    data: stringData,
    android: { priority: "high" },
    apns: {
      payload: {
        aps: { contentAvailable: true },
      },
      headers: { "apns-priority": "10" },
    },
  };
  try {
    const response = await firebaseAdmin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    if (error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered") {
      return { success: false, error: "invalid_token", message: error.message };
    }
    throw error;
  }
};

/**
 * Send FCM notification to multiple devices
 * @param {string[]} fcmTokens - Array of FCM tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} - FCM batch response
 */
export const sendNotificationToMultipleDevices = async (fcmTokens, title, body, data = {}) => {
  if (!firebaseAdmin) {
    throw new Error("Firebase Admin SDK not initialized");
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    throw new Error("At least one FCM token is required");
  }

  // Filter out null/undefined tokens
  const validTokens = fcmTokens.filter(token => token && token.trim() !== "");

  if (validTokens.length === 0) {
    throw new Error("No valid FCM tokens provided");
  }

  const stringData = Object.fromEntries(
    Object.entries({
      ...data,
      title,
      body,
      timestamp: new Date().toISOString(),
    }).map(([k, v]) => [k, v != null ? String(v) : ''])
  );

  const message = {
    notification: {
      title,
      body,
    },
    data: stringData,
    webpush: buildWebPushConfig(title, body, data),
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
    tokens: validTokens,
  };

  try {
    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
    console.log(`✅ Successfully sent ${response.successCount} notifications`);
    console.log(`❌ Failed to send ${response.failureCount} notifications`);
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    };
  } catch (error) {
    console.error("❌ Error sending FCM notifications:", error);
    throw error;
  }
};

/**
 * Send FCM notification to a topic
 * @param {string} topic - Topic name
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} - FCM response
 */
export const sendNotificationToTopic = async (topic, title, body, data = {}) => {
  if (!firebaseAdmin) {
    throw new Error("Firebase Admin SDK not initialized");
  }

  const message = {
    topic,
    notification: {
      title,
      body,
    },
    data: {
      ...data,
      title,
      body,
      timestamp: new Date().toISOString(),
    },
    webpush: buildWebPushConfig(title, body, data),
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  };

  try {
    const response = await firebaseAdmin.messaging().send(message);
    console.log("✅ Successfully sent FCM notification to topic:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ Error sending FCM notification to topic:", error);
    throw error;
  }
};

