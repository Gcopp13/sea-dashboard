// stripe-checkout.js — creates a Stripe Checkout session for monthly subscription
// Uses native fetch (no npm deps)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, email } = JSON.parse(event.body || '{}');
    if (!userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId and email required' }) };
    }

    // Create Stripe Checkout session
    const params = new URLSearchParams({
      'payment_method_types[]': 'card',
      'mode': 'subscription',
      'line_items[0][price]': PRICE_ID,
      'line_items[0][quantity]': '1',
      'customer_email': email,
      'client_reference_id': userId,
      'success_url': `${APP_URL}?session_id={CHECKOUT_SESSION_ID}&subscribed=true`,
      'cancel_url': `${APP_URL}?canceled=true`,
      'metadata[user_id]': userId,
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error('Stripe error:', session);
      return { statusCode: 500, body: JSON.stringify({ error: session.error?.message || 'Stripe error' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    console.error('stripe-checkout error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
