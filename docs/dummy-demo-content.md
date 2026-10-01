# Dummy demo content: Helo.ai

Copy-paste text for every field in the console, written from helo.ai, so a dummy-mode demo looks real. Fields are in the order the screens show them. The character limits shown are the UI's own.

> **Before you start:** open the flask button (bottom-right) and turn on **Dummy mode**. Prices below are demo prices, not Helo.ai's real pricing.

---

## 1. Create agent

| Field | Enter |
|---|---|
| Agent name | `Helo Sales Assistant` |
| WhatsApp Business Account | *(auto-selected: your real WABA from `.env`)* |
| Phone number | *(your real number from `.env`)* |

Then click **Check eligibility** → "Number is eligible" → **Create agent**.

---

## 2. Identity

**Agent name:** `Helo Sales Assistant`

**What the agent does** (max 250):
```
Helps businesses learn about Helo.ai's products (Voice, Messaging, Clarity, Convo and Touchpoints), compares plans, books product demos, and lets customers start a monthly plan and pay right inside WhatsApp.
```

---

## 3. Business profile

### About your business

**Business description** (max 500):
```
Helo.ai is an AI-first customer communication platform by Vivaconnect, built on 25 years of enterprise communication experience. We help banks, insurers, fintechs, e-commerce and retail brands engage customers faster and smarter across WhatsApp, RCS, SMS, Email and Voice. Our products include Helo Voice, Helo Messaging, Helo Clarity, Helo Convo and Helo Touchpoints. We are an official Meta Business Solution Provider and deliver over 30 billion messages a year.
```

**Payment methods:** tick **UPI**, **Cards**, **Net banking**. For **Other**, enter `Bank transfer (NEFT/RTGS)`.

### Your policies

**Cancellations & refunds** (max 1000):
```
Monthly plans can be cancelled anytime from your Helo.ai dashboard or by writing to support@helo.ai. Cancellation takes effect at the end of the current billing month, and no further charges are made. If you cancel within 7 days of your first payment, we refund the full amount. Usage-based charges (such as messages already sent) are not refundable. Refunds are made to the original payment method within 5 to 7 working days.
```

**How customers buy or book** (max 1000):
```
You can start a monthly plan for any product right here on WhatsApp: ask to see our products, tap "Buy now" and pay securely by UPI, card or net banking. For enterprise plans, custom volumes or on-premise deployment, ask to book a demo and our sales team will call you within one working day. Existing customers can upgrade or add products from the Helo.ai dashboard.
```

**Delivery or fulfilment** (max 1000):
```
All Helo.ai products are cloud software, so there is nothing to ship. Your plan is activated within 24 hours of payment, and a dedicated account manager contacts you to complete setup. WhatsApp and RCS onboarding need Meta and Google approval of your business, which usually takes 1 to 3 working days. Data is hosted in India, and on-premise or private-cloud deployment is available on enterprise plans.
```

### How customers reach you

| Field | Enter |
|---|---|
| Contact email | `support@helo.ai` |
| Business address (max 300) | `VivaPlex, C7, Street 22, MIDC, Opp Rolta Technology Park, Andheri East, Mumbai 400093` |
| Business hours | Mon–Fri `09:30`–`18:30`, Sat `10:00`–`14:00`, Sun **Closed** |

---

## 4. Abilities → Personality

| Setting | Choose |
|---|---|
| Tone | **Professional** |
| Emoji use | **Sparingly** |
| Answer length | **Standard** |
| Default language | **English** |
| Additional languages | **Hindi**, **Marathi** |
| Match customer's language automatically | **On** |

If you pick **Custom tone**, use this:
```
Warm, confident and consultative, like a helpful product specialist. Keep answers short and practical, use simple words, and always offer a clear next step such as a demo or a plan.
```

---

## 5. Abilities → Skills

Add each of these as its own skill.

**Skill 1**
- **Skill name:** `Recommend the right product`
- **Description:** `When a customer is unsure which Helo.ai product fits their needs or asks for a comparison.`
- **Instruction:**
```
Ask one question about their goal: answering calls, sending campaigns, tracking conversions, automating chats, or joining up customer journeys. Then recommend one product: Helo Voice for calls, Helo Messaging for campaigns on WhatsApp, RCS, SMS and Email, Helo Clarity for tracking and reports, Helo Convo for AI chat agents, and Helo Touchpoints for multi-channel journeys. Give one sentence on why, then offer the product carousel or a demo.
```

**Skill 2**
- **Skill name:** `Book a product demo`
- **Description:** `When a customer asks for a demo, a call back, enterprise pricing, or custom volumes.`
- **Instruction:**
```
Collect the customer's name, company name, work email and the product they are interested in, one question at a time. Confirm the details back to them, then tell them a Helo.ai specialist will call within one working day. Do not quote enterprise prices.
```

**Skill 3**
- **Skill name:** `Explain data security`
- **Description:** `When a customer asks about data privacy, compliance, hosting or security certifications.`
- **Instruction:**
```
Explain that Helo.ai hosts data in India on its own infrastructure, is SOC 2 Type II and ISO 27001 certified, is aligned with India's DPDP Act, and offers on-premise or private-cloud deployment. Mention end-to-end encryption, role-based access, SSO and audit logs. For detailed security questionnaires, offer to connect them with the security team.
```

---

## 6. Abilities → Rich replies

**Rich reply 1: Button with a link**
| Field | Enter |
|---|---|
| When should the agent send this? | `When someone asks how to sign up, see pricing, or visit the website` |
| Body | `Explore all Helo.ai products, see plans and start a free trial on our website.` |
| Footer | `Helo.ai by Vivaconnect` |
| Button text | `Visit Helo.ai` |
| Button URL | `https://www.helo.ai` |

**Rich reply 2: Location**
| Field | Enter |
|---|---|
| When should the agent send this? | `When someone asks where our office is or wants to visit us` |
| Name | `Helo.ai (Vivaconnect) Mumbai office` |
| Address | `VivaPlex, C7, Street 22, MIDC, Andheri East, Mumbai 400093` |
| Latitude | `19.1176` |
| Longitude | `72.8722` |

**Rich reply 3: Reply buttons**
| Field | Enter |
|---|---|
| When should the agent send this? | `When someone asks what they can do here or how to get started` |
| Body | `How can I help you today?` |
| Buttons | `See products` · `Book a demo` · `Talk to sales` |

---

## 7. Knowledge → FAQs

| Question | Answer |
|---|---|
| `What is Helo.ai?` | `Helo.ai is an AI-first customer communication platform by Vivaconnect. It helps businesses engage customers on WhatsApp, RCS, SMS, Email and Voice, with AI agents, campaigns and analytics in one place.` |
| `What is Helo Convo?` | `Helo Convo is a no-code AI agent platform for WhatsApp, web and app. You describe the agent in plain words and it is ready in about 5 minutes. It handles 80% of queries without a human and hands over to your team when needed.` |
| `What is Helo Voice?` | `Helo Voice is an AI voicebot that answers and makes calls, resolves queries instantly, and understands 12 Indian languages including Hindi, Marathi, Tamil and Bengali.` |
| `What is Helo Clarity?` | `Helo Clarity tracks every campaign from send to conversion, with real-time reports across all your channels.` |
| `Which channels do you support?` | `WhatsApp, RCS, SMS, Email and Voice, all from one platform.` |
| `Is my data safe with Helo.ai?` | `Yes. Data is hosted in India on Helo.ai's own infrastructure. We are SOC 2 Type II and ISO 27001 certified and aligned with India's DPDP Act. On-premise and private-cloud options are available.` |
| `Which industries do you work with?` | `Banking, fintech, insurance, e-commerce, retail and utilities. Customers include Aditya Birla Capital and Kotak Mahindra.` |
| `How quickly can I go live?` | `Plans are activated within 24 hours of payment. WhatsApp and RCS approval from Meta and Google usually takes 1 to 3 working days.` |
| `How do I contact support?` | `Email support@helo.ai or call 022 6785 6785, Monday to Friday 9:30 am to 6:30 pm, Saturday 10 am to 2 pm.` |

## 8. Knowledge → Websites

Add each one (in dummy mode the crawl runs and finishes on its own):
```
https://www.helo.ai
https://www.helo.ai/products/helo-convo
https://www.helo.ai/products/whatsapp
https://www.helo.ai/products/voice-bot
```

## 9. Knowledge → Documents

Upload any PDF from your machine. A good choice is a Helo.ai product brochure or one-pager, such as `Helo-ai-Product-Overview.pdf`. In dummy mode only the file name is used.

---

## 10. Connections (optional)

**Connection**
| Field | Enter |
|---|---|
| Name | `Helo CRM` |
| Description | `Helo.ai's CRM: customer accounts, plans and demo bookings.` |
| Base web address | `https://api.helo.ai/crm/v1` |
| Connection type | **Access key** |
| Field name | `X-API-Key` |
| Access key | `demo-key-123` *(anything works in dummy mode)* |

**Action**
| Field | Enter |
|---|---|
| Action name | `Book a demo` |
| When should the agent use this? | `when a customer asks for a product demo and has shared their name, company and email` |
| Method | **POST** |
| Path | `/demos` |

---

## 10b. Connections → Shopify MCP server (real testing, dummy mode off)

Meta's agent reaches your Shopify catalog through the bridge at `api/shopify-mcp.ts`, which must be deployed publicly (e.g. on Vercel) so Meta's servers can call it.

| Field | Enter |
|---|---|
| Name | `Shopify store` |
| Description | `Our Shopify catalog: search products, look up items and get product details, prices and stock.` |
| Connection type | **MCP server** |
| MCP server address | `https://<your-vercel-app>.vercel.app/api/shopify-mcp?store=<your-store>.myshopify.com` |
| Authentication | **No authentication** |

Save it, then click **Refresh tools**. The status should reach **Ready (3 tools)**, and `search_catalog`, `lookup_catalog` and `get_product` appear as test-only actions. Then in Test, try `Do you have running shoes under $100?`

---

## 11. Safety & handoff

| Setting | Choose / enter |
|---|---|
| How much the agent can improvise | **Strict** *(answers only from what you've given it)* |
| What the agent says when it hands over | **Custom message**: `Let me connect you with a Helo.ai specialist. Someone from our team will reply here shortly.` |
| Follow up after | **1 hour** |
| Follow-up message | `Hi! Just checking in. Do you have any other questions about Helo.ai, or would you like to book a quick demo?` |

**Specific words or phrases** the agent must never say (press Enter after each):
```
guaranteed delivery
100% uptime
free forever
```

**Topics to avoid** (press Enter after each):
```
Comparing us to specific competitors
Unannounced products or roadmap
Pricing for enterprise or custom plans
```

---

## 12. Test & Eval: the scripted conversation

1. Type: `What is your company about?`
   → The agent introduces Helo.ai, using the business description you entered.
2. Tap the suggestion **What products do you have?**
   → A carousel of **Helo Voice, Helo Messaging, Helo Clarity, Helo Convo, Helo Touchpoints**.
3. Tap **Buy now** on **Helo Voice** (the first card)
   → Order details, and the payment sheet opens.
4. Choose UPI, card or net banking → **Pay ₹14,999**
   → "Processing…", then "Payment successful".
5. The agent sends **Order confirmed** with the order number, plan, amount, payment ID and go-live date.

Then, on the **Evaluation** tab, run any case. It moves through all three stages and scores the agent.

| Carousel product | Card text | Demo price / month |
|---|---|---|
| Helo Voice | AI voicebots that answer calls, resolve queries and speak 12 Indian languages | ₹14,999 |
| Helo Messaging | WhatsApp, RCS, SMS and Email from one platform, with rich media and buttons | ₹4,999 |
| Helo Clarity | Track every campaign from send to conversion, with real-time reports | ₹7,999 |
| Helo Convo | No-code AI agents for WhatsApp, web and app that end in a resolution | ₹9,999 |
| Helo Touchpoints | Connect every customer touchpoint into one journey across channels | ₹5,999 |

---

## 13. Publish

**Allowlisted test numbers** (format `+15551234567`, no spaces):
```
+919820012345
+919833098765
```
Audience: **Allowlisted only** → **Switch on**. In dummy mode the agent "goes live" without touching the real number.
