import Stripe from 'stripe'
import { createServiceClient, getHeader, jsonResponse } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey || !webhookSecret) return jsonResponse(500, { error: 'Stripe not configured' })

  const stripe = new Stripe(stripeKey)
  const body = await req.text()
  const signature = getHeader(req, 'stripe-signature')

  if (!signature) return jsonResponse(400, { error: 'Missing stripe-signature' })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    return jsonResponse(400, { error: message })
  }

  const service = createServiceClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.client_reference_id || session.metadata?.userId
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string

      if (!userId) break

      // Save customer ID to profile
      await service
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)

      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const item = subscription.items.data[0]

      // Upsert subscription record
      await service.from('subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: item.price.id,
        status: subscription.status,
        current_period_start: new Date(item.current_period_start * 1000).toISOString(),
        current_period_end: new Date(item.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      }, { onConflict: 'stripe_subscription_id' })

      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const updatedItem = subscription.items.data[0]
      await service
        .from('subscriptions')
        .update({
          status: subscription.status,
          stripe_price_id: updatedItem.price.id,
          current_period_start: new Date(updatedItem.current_period_start * 1000).toISOString(),
          current_period_end: new Date(updatedItem.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      await service
        .from('subscriptions')
        .update({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const sub = invoice.parent?.subscription_details?.subscription
      const subscriptionId = typeof sub === 'string' ? sub : sub?.id
      if (subscriptionId) {
        await service
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscriptionId)
      }
      break
    }
  }

  return jsonResponse(200, { received: true })
}
