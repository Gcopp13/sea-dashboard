/**
 * invite-coach.js
 * Admin sends an invite to a new coach.
 * Creates the user account with role=coach in profiles,
 * then sends a branded invite email via Resend.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const ok  = (d)    => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(d) });
const err = (m, s) => ({ statusCode: s||500, headers: CORS_HEADERS, body: JSON.stringify({ error: m }) });

const coachInviteEmailHTML = (inviterName, appUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You've been invited as a coach</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#1e2a4a 0%,#2d1b69 100%);padding:40px 40px 32px;text-align:center;">
          <div style="font-size:2rem;font-weight:900;letter-spacing:-1px;color:white;">S.E.A.</div>
          <div style="color:#a78bfa;font-size:0.85rem;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Slight Edge Accelerator</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:40px;">
          <h2 style="color:#1e293b;font-size:1.5rem;margin:0 0 16px;">You've been invited as a coach!</h2>
          <p style="color:#475569;line-height:1.7;margin:0 0 20px;">
            <strong>${inviterName || 'Getting Results Inc.'}</strong> has invited you to join the S.E.A. Dashboard as a <strong>coach</strong>.
          </p>
          <p style="color:#475569;line-height:1.7;margin:0 0 32px;">
            Click the button below to set up your account. You'll have access to your Coach Dashboard where you can manage your clients, track their progress, and send messages.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
              <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:16px 40px;text-align:center;">
                <a href="${appUrl}" style="color:white;text-decoration:none;font-weight:700;font-size:1rem;letter-spacing:0.5px;">
                  Set Up My Coach Account &rarr;
                </a>
              </td>
            </tr>
          </table>
          <p style="color:#94a3b8;font-size:0.85rem;text-align:center;margin:0;">
            Live by design, not by default.
          </p>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:0.8rem;margin:0;text-align:center;">
            You received this invitation from ${inviterName || 'Getting Results Inc.'} via the S.E.A. Dashboard.<br>
            Please do not reply to this email &mdash; this mailbox is not monitored.<br>
            <a href="https://sea-dashboard.netlify.app" style="color:#6366f1;">Getting Results Inc.</a> &middot; Coaching for Financial Advisors
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  const SUPABASE_URL   = process.env.SUPABASE_URL;
  const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const APP_URL        = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return err('Missing required environment variables', 500);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON', 400); }

  const { email, inviterId } = body;
  if (!email) return err('email is required', 400);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err('Invalid email address', 400);
  }

  try {
    // Fetch inviter's real name from Supabase profiles
    let inviterName = 'Getting Results Inc.';
    if (inviterId) {
      try {
        const profileRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(inviterId)}&select=full_name&limit=1`,
          { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        );
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData?.[0]?.full_name) inviterName = profileData[0].full_name;
        }
      } catch (e) {
        console.warn('[invite-coach] Could not fetch inviter profile:', e.message);
      }
    }

    // Create the user account (or get existing)
    let userId = null;
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { invited_as_coach: true },
      }),
    });

    if (createRes.ok) {
      const createData = await createRes.json();
      userId = createData.id;
    } else {
      const createErr = await createRes.json();
      if (createErr.message?.toLowerCase().includes('already')) {
        // User exists — look up their ID
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
          { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        );
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          userId = lookupData?.[0]?.id || null;
        }
      } else {
        console.error('[invite-coach] Supabase create user error:', createErr);
        return err('Failed to create coach account. Please try again.', 500);
      }
    }

    // Set role=coach in profiles (upsert)
    if (userId) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ id: userId, email, role: 'coach' }),
      });
    }

    // Generate magic link so they can set their password
    const redirectTo = `${APP_URL}?new_coach=1`;
    const magicRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'magiclink',
        email,
        options: { redirect_to: redirectTo },
      }),
    });

    if (!magicRes.ok) {
      const magicErr = await magicRes.json();
      console.error('[invite-coach] Magic link generation failed:', magicErr);
      return err('Failed to generate invite link. Please try again.', 500);
    }

    const magicData = await magicRes.json();
    const inviteLink = magicData.action_link || magicData.hashed_token;

    if (!inviteLink) {
      return err('No invite link returned from auth service', 500);
    }

    // Send the invite email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SEA Dashboard <onboarding@gettingresultsinc.com>',
        to: [email],
        subject: `${inviterName} has invited you to coach on the S.E.A. Dashboard`,
        html: coachInviteEmailHTML(inviterName, inviteLink),
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.json();
      console.error('[invite-coach] Resend error:', emailErr);
      return err('Failed to send invite email. Please try again.', 500);
    }

    return ok({ success: true, message: `Coach invitation sent to ${email}` });

  } catch (e) {
    console.error('[invite-coach] error:', e);
    return err(e.message, 500);
  }
};
