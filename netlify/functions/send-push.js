// send-push.js — shared helper to send a web push notification to a subscription
// Used internally by evening-reminder, weekly-ritual-reminder, coach-nudge

const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:gino.coppola@gettingresultsinc.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send a push notification to a single subscription record.
 * @param {object} sub - { endpoint, p256dh, auth }
 * @param {object} payload - { title, body, tag, url }
 * @returns {object} { ok: boolean, gone: boolean, error?: string }
 */
async function sendPush(sub, payload) {
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth }
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { ok: true, gone: false };
  } catch (err) {
    // 410 Gone = subscription expired/revoked, should be deleted
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { ok: false, gone: true };
    }
    console.error('sendPush error:', err.message);
    return { ok: false, gone: false, error: err.message };
  }
}

module.exports = { sendPush };
