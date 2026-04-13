// stripe-webhook.js — handles Stripe events and updates Supabase subscription status
// Uses native fetch (no npm deps)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Minimal Stripe webhook signature verification (no stripe npm package needed)
async function verifyStripeSignature(body, signature, secret) {
  try {
    const parts = signature.split(',').reduce((acc, part) => {
      const [key, val] = part.split('=');
      acc[key] = val;
      return acc;
    }, {});

    const timestamp = parts['t'];
    const sigHash = parts['v1'];

    const payload = `${timestamp}.${body}`;

    // Use Web Crypto API to compute HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const computedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return computedSig === sigHash;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

async function updateSubscription(userId, status, stripeCustomerId, stripeSubscriptionId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      subscription_status: status,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Supabase update error:', text);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['stripe-signature'];
  if (!signature) {
    return { statusCode: 400, body: 'Missing stripe-signature header' };
  }

  // Verify webhook signature
  const isValid = await verifyStripeSignature(event.body, signature, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error('Invalid Stripe signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata?.user_id || session.client_reference_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId) {
          await updateSubscription(userId, 'active', customerId, subscriptionId);
          console.log(`Subscription activated for user ${userId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;

        // Look up user by stripe_customer_id
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        });
        const rows = await res.json();
        if (rows && rows.length > 0) {
          await updateSubscription(rows[0].id, 'canceled', customerId, subscription.id);
          console.log(`Subscription canceled for customer ${customerId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;
        const status = subscription.status === 'active' ? 'active' : 'canceled';

        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        });
        const rows = await res.json();
        if (rows && rows.length > 0) {
          await updateSubscription(rows[0].id, status, customerId, subscription.id);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (e) {
    console.error('Webhook handler error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
