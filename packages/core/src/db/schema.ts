/**
 * Fekerte database schema (Drizzle ORM, Postgres).
 *
 * Multi-tenancy: every tenant-owned table carries `business_id`. Isolation is
 * enforced twice: (1) the data-access layer always filters by business_id and
 * (2) Postgres row-level security policies (see drizzle/*_rls.sql) scoped to
 * the `fekerte_app` role + the `app.business_id` session setting.
 *
 * Double-booking is prevented by a gist exclusion constraint on
 * (staff_id, tstzrange(blocked_start, blocked_end)) for non-cancelled
 * appointments (see the custom migration).
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Shared JSON types
// ---------------------------------------------------------------------------

export type Locale = "ar" | "en" | "fr";
export const LOCALES: Locale[] = ["ar", "en", "fr"];

/** Text in up to three languages. At least one should be present. */
export type LocalizedText = Partial<Record<Locale, string>>;

export type FeatureFlags = {
  whatsappAi?: boolean;
  voiceAi?: boolean;
  webChat?: boolean;
  deposits?: boolean;
  reviews?: boolean;
  recalls?: boolean;
  campaigns?: boolean;
  [key: string]: boolean | undefined;
};

export type Branding = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  coverImageUrl?: string | null;
  tagline?: LocalizedText;
};

export type BookingSettings = {
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotGranularityMinutes: number;
  allowAnyStaff: boolean;
  /** New online bookings start as `pending` until staff confirm. */
  requireApproval: boolean;
  /** Customers may cancel/reschedule online up to this many hours before. */
  cancellationNoticeHours: number;
  /** Reminder offsets before the appointment, in minutes. */
  reminderOffsetsMinutes: number[];
  /** Ask the customer to confirm ("reply 1 to confirm") with the first reminder. */
  askConfirmation: boolean;
  /** Auto-cancel unpaid deposit holds after this many hours. */
  depositHoldHours: number;
  /** Require deposit for customers with at least this many no-shows (0 = off). */
  depositAfterNoShows: number;
  policies?: LocalizedText;
};

export type AiSettings = {
  personaName?: string;
  tone?: "warm" | "professional" | "casual";
  greeting?: LocalizedText;
  extraInstructions?: string;
  /** Voice pipeline: realtime speech-to-speech or STT→LLM→TTS cascade. */
  voicePipeline?: "realtime" | "cascade";
  voiceName?: string;
  /** When the voice agent answers: always, only after hours, or only when staff don't pick up. */
  voiceMode?: "always" | "after_hours" | "overflow";
  overflowRingSeconds?: number;
  transferNumber?: string | null;
  whatsappAutoReply?: boolean;
};

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  minNoticeMinutes: 120,
  maxDaysAhead: 60,
  slotGranularityMinutes: 15,
  allowAnyStaff: true,
  requireApproval: false,
  cancellationNoticeHours: 12,
  reminderOffsetsMinutes: [24 * 60, 120],
  askConfirmation: true,
  depositHoldHours: 12,
  depositAfterNoShows: 0,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  personaName: "Maya",
  tone: "warm",
  voicePipeline: "cascade",
  voiceMode: "always",
  overflowRingSeconds: 20,
  transferNumber: null,
  whatsappAutoReply: true,
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planTierEnum = pgEnum("plan_tier", ["basic", "standard", "premium"]);
export const businessStatusEnum = pgEnum("business_status", ["trial", "active", "paused", "cancelled"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "staff"]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);
export const appointmentSourceEnum = pgEnum("appointment_source", [
  "dashboard",
  "booking_page",
  "whatsapp",
  "voice",
  "web_chat",
]);
export const channelEnum = pgEnum("channel", ["whatsapp", "voice", "web_chat"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["ai_active", "human_takeover", "closed"]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageSenderEnum = pgEnum("message_sender", ["customer", "ai", "staff", "system"]);
export const callDirectionEnum = pgEnum("call_direction", ["inbound", "outbound"]);
export const callOutcomeEnum = pgEnum("call_outcome", [
  "booked",
  "rescheduled",
  "cancelled",
  "info",
  "transferred",
  "message_taken",
  "missed",
  "abandoned",
]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed", "cancelled"]);
export const depositStatusEnum = pgEnum("deposit_status", ["none", "required", "paid", "waived", "refunded"]);
export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "paused",
  "cancelled",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "paid", "void"]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "bank_transfer",
  "wallet",
  "card",
  "payment_link",
  "other",
]);
export const leadStageEnum = pgEnum("lead_stage", ["new", "demo_scheduled", "demo_done", "trial", "paying", "lost"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const id = () => uuid("id").primaryKey().defaultRandom();
const businessId = () => uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tstz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Platform-level tables (not tenant scoped)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash"),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    locale: text("locale").$type<Locale>(),
    createdAt: createdAt(),
    lastLoginAt: tstz("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").$type<"magic_link" | "password_reset">().notNull(),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_unique").on(t.tokenHash)],
);

export const plans = pgTable("plans", {
  tier: planTierEnum("tier").primaryKey(),
  name: text("name").notNull(),
  setupFeeCents: integer("setup_fee_cents").notNull().default(0),
  monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
  includedAiMessages: integer("included_ai_messages").notNull().default(0),
  includedVoiceMinutes: integer("included_voice_minutes").notNull().default(0),
  overageAiMessageCents: integer("overage_ai_message_cents").notNull().default(0),
  overageVoiceMinuteCents: integer("overage_voice_minute_cents").notNull().default(0),
  features: jsonb("features").$type<FeatureFlags>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const leads = pgTable("leads", {
  id: id(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  phone: text("phone"),
  email: text("email"),
  vertical: text("vertical"),
  city: text("city"),
  message: text("message"),
  stage: leadStageEnum("stage").notNull().default("new"),
  notes: text("notes"),
  source: text("source"),
  businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    vertical: text("vertical").notNull().default("clinic"),
    timezone: text("timezone").notNull().default("Asia/Beirut"),
    defaultLanguage: text("default_language").$type<Locale>().notNull().default("ar"),
    languages: text("languages").array().$type<Locale[]>().notNull().default(sql`ARRAY['ar','en','fr']::text[]`),
    currency: text("currency").notNull().default("USD"),
    showLbp: boolean("show_lbp").notNull().default(false),
    lbpRate: integer("lbp_rate").notNull().default(89500),
    planTier: planTierEnum("plan_tier").notNull().default("basic"),
    status: businessStatusEnum("status").notNull().default("trial"),
    trialEndsAt: tstz("trial_ends_at"),
    featureFlags: jsonb("feature_flags").$type<FeatureFlags>().notNull().default({}),
    branding: jsonb("branding").$type<Branding>().notNull().default({}),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    mapsUrl: text("maps_url"),
    googleReviewUrl: text("google_review_url"),
    /** Customer-facing WhatsApp number (E.164). */
    whatsappNumber: text("whatsapp_number"),
    /** Meta WhatsApp Cloud API phone_number_id that routes inbound webhooks to this business. */
    whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
    /** Our provisioned voice number (E.164) that the business forwards calls to. */
    voiceNumber: text("voice_number"),
    aiSettings: jsonb("ai_settings").$type<AiSettings>().notNull().default(DEFAULT_AI_SETTINGS),
    bookingSettings: jsonb("booking_settings").$type<BookingSettings>().notNull().default(DEFAULT_BOOKING_SETTINGS),
    onboardingCompletedAt: tstz("onboarding_completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("businesses_slug_unique").on(t.slug),
    uniqueIndex("businesses_wa_phone_id_unique").on(t.whatsappPhoneNumberId),
    uniqueIndex("businesses_voice_number_unique").on(t.voiceNumber),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessId: businessId(),
    role: memberRoleEnum("role").notNull().default("staff"),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_business_unique").on(t.userId, t.businessId), index().on(t.businessId)],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    address: text("address"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const resources = pgTable(
  "resources",
  {
    id: id(),
    businessId: businessId(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const staff = pgTable(
  "staff",
  {
    id: id(),
    businessId: businessId(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: jsonb("title").$type<LocalizedText>().notNull().default({}),
    color: text("color").notNull().default("#0ea5e9"),
    email: text("email"),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: businessId(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>().notNull().default({}),
    category: text("category"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    /** Price in USD cents. Null = "ask us". */
    priceCents: integer("price_cents"),
    /** Price is a starting price ("from $X"). */
    priceFrom: boolean("price_from").notNull().default(false),
    depositRequired: boolean("deposit_required").notNull().default(false),
    depositCents: integer("deposit_cents").notNull().default(0),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    /** Suggest a recall/rebook after this many days (Phase 5). */
    recallIntervalDays: integer("recall_interval_days"),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const staffServices = pgTable(
  "staff_services",
  {
    businessId: businessId(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), index().on(t.businessId)],
);

/**
 * Weekly working hours. `staff_id` null = business opening hours.
 * weekday: ISO 1 (Monday) .. 7 (Sunday). Several rows per day = split shifts.
 */
export const workingHours = pgTable(
  "working_hours",
  {
    id: id(),
    businessId: businessId(),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index().on(t.businessId, t.staffId)],
);

/** Recurring weekly breaks (e.g. lunch). `staff_id` null = applies to everyone. */
export const breaks = pgTable(
  "breaks",
  {
    id: id(),
    businessId: businessId(),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    label: text("label"),
  },
  (t) => [index().on(t.businessId, t.staffId)],
);

/** One-off staff absences (vacation, sick leave, partial day). */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    businessId: businessId(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.staffId)],
);

/** Full-day closures in business-local dates. `staff_id` null = whole business closed. */
export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    businessId: businessId(),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    name: text("name"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: businessId(),
    /** E.164 phone number — the customer's identity within a business. */
    phone: text("phone").notNull(),
    name: text("name"),
    preferredLanguage: text("preferred_language").$type<Locale>(),
    notes: text("notes"),
    tags: text("tags").array().$type<string[]>().notNull().default(sql`ARRAY[]::text[]`),
    consentWhatsapp: boolean("consent_whatsapp").notNull().default(true),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    consentedAt: tstz("consented_at"),
    optedOutAt: tstz("opted_out_at"),
    noShowCount: integer("no_show_count").notNull().default(0),
    lastVisitAt: tstz("last_visit_at"),
    source: appointmentSourceEnum("source"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_business_phone_unique").on(t.businessId, t.phone), index().on(t.businessId, t.name)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    businessId: businessId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    channel: channelEnum("channel").notNull(),
    status: conversationStatusEnum("status").notNull().default("ai_active"),
    /** Channel-specific external id: WhatsApp phone, web-chat session id, call id. */
    externalId: text("external_id"),
    lastMessageAt: tstz("last_message_at"),
    lastInboundAt: tstz("last_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary"),
    /** Language the customer last wrote in ("arabizi" = Arabic in Latin letters). */
    language: text("language").$type<ConversationLanguage>(),
    /** Short-lived agent working memory (last offered slots, focus appointment, …). */
    state: jsonb("state").$type<AgentState>().notNull().default({}),
    /** Lease so only one worker generates a reply for a conversation at a time. */
    processingUntil: tstz("processing_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.businessId, t.lastMessageAt), index().on(t.businessId, t.channel, t.externalId)],
);

export type ConversationLanguage = "ar" | "arabizi" | "en" | "fr";

export type OfferedSlot = { start: string; staffId: string; staffName: string };

/** Agent working memory persisted per conversation (see packages/core/src/agent/state.ts). */
export type AgentState = {
  /** Last availability offered to the customer. */
  offer?: { serviceId: string; serviceName: string; staffId?: string | null; slots: OfferedSlot[]; at: string };
  /** Upcoming appointments last looked up for this customer. */
  appointments?: { id: string; start: string; serviceName: string; staffName: string; serviceId?: string }[];
  /** What the customer is trying to do. */
  intent?: "book" | "reschedule" | "cancel" | null;
  serviceId?: string | null;
  /** Appointment the customer is talking about (reschedule/cancel). */
  focusAppointmentId?: string | null;
  /** A slot the customer picked, waiting for their name before booking. */
  pendingSlot?: OfferedSlot & { serviceId: string };
  /** Voice: details read back to the caller, waiting for a yes before booking/moving. */
  pendingConfirm?: OfferedSlot & { serviceId: string; intent: "book" | "reschedule"; name?: string | null };
  /** Appointments created in this conversation (web chat may only manage these). */
  createdAppointmentIds?: string[];
  /** Consecutive turns where the agent did not understand. */
  confusedCount?: number;
  /** Date/time the customer asked for, remembered until a service is chosen. */
  requested?: { date?: string | null; part?: "morning" | "afternoon" | "evening" | null; time?: string | null };
  /** Phone given in web chat (unverified). */
  claimedPhone?: string | null;
  customerName?: string | null;
};

export type ToolCallLog = {
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
};

export const messages = pgTable(
  "messages",
  {
    id: id(),
    businessId: businessId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    sender: messageSenderEnum("sender").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    contentType: text("content_type").$type<"text" | "audio" | "image" | "template" | "event">().notNull().default("text"),
    body: text("body"),
    mediaUrl: text("media_url"),
    transcript: text("transcript"),
    providerMessageId: text("provider_message_id"),
    status: notificationStatusEnum("status"),
    /** Tool calls the AI made while producing this message (audit trail). */
    toolCalls: jsonb("tool_calls").$type<ToolCallLog[]>(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.conversationId, t.createdAt),
    index().on(t.providerMessageId),
    uniqueIndex("messages_inbound_provider_id_unique")
      .on(t.businessId, t.providerMessageId)
      .where(sql`direction = 'inbound' and provider_message_id is not null`),
  ],
);

export type TranscriptTurn = { role: "caller" | "agent" | "system"; text: string; at: string };

export const calls = pgTable(
  "calls",
  {
    id: id(),
    businessId: businessId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    appointmentId: uuid("appointment_id").references((): AnyPgColumn => appointments.id, { onDelete: "set null" }),
    provider: text("provider").notNull().default("mock"),
    providerCallId: text("provider_call_id"),
    direction: callDirectionEnum("direction").notNull().default("inbound"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    pipeline: text("pipeline"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    transcript: jsonb("transcript").$type<TranscriptTurn[]>().notNull().default([]),
    summary: text("summary"),
    outcome: callOutcomeEnum("outcome"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.startedAt), index().on(t.providerCallId)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    businessId: businessId(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    /** Maintained by trigger: starts_at - buffer_before. Used by the exclusion constraint. */
    blockedStart: tstz("blocked_start").notNull(),
    /** Maintained by trigger: ends_at + buffer_after. */
    blockedEnd: tstz("blocked_end").notNull(),
    status: appointmentStatusEnum("status").notNull().default("confirmed"),
    source: appointmentSourceEnum("source").notNull(),
    notes: text("notes"),
    internalNotes: text("internal_notes"),
    priceCents: integer("price_cents"),
    depositStatus: depositStatusEnum("deposit_status").notNull().default("none"),
    depositCents: integer("deposit_cents").notNull().default(0),
    depositDueAt: tstz("deposit_due_at"),
    customerConfirmedAt: tstz("customer_confirmed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancelledBy: text("cancelled_by").$type<"customer" | "staff" | "system" | "ai">(),
    cancelReason: text("cancel_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.businessId, t.startsAt),
    index().on(t.businessId, t.customerId),
    index().on(t.staffId, t.startsAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    businessId: businessId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    channel: channelEnum("channel").notNull().default("whatsapp"),
    toAddress: text("to_address").notNull(),
    templateName: text("template_name").notNull(),
    language: text("language").$type<Locale>().notNull(),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    body: text("body").notNull(),
    status: notificationStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.createdAt), index().on(t.appointmentId), index().on(t.providerMessageId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: tstz("run_at").notNull().defaultNow(),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: tstz("locked_at"),
    dedupeKey: text("dedupe_key"),
    completedAt: tstz("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_unique").on(t.dedupeKey),
    index().on(t.businessId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    businessId: businessId(),
    type: text("type").$type<"ai_message" | "voice_minute" | "whatsapp_template" | "stt_second">().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull().default(1),
    /** Billing period "YYYY-MM" (business-local). */
    period: text("period").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.period, t.type)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    businessId: businessId(),
    planTier: planTierEnum("plan_tier").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    setupFeeCents: integer("setup_fee_cents").notNull().default(0),
    monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
    setupFeePaid: boolean("setup_fee_paid").notNull().default(false),
    trialEndsAt: tstz("trial_ends_at"),
    currentPeriodStart: tstz("current_period_start"),
    currentPeriodEnd: tstz("current_period_end"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("subscriptions_business_unique").on(t.businessId)],
);

export type InvoiceLine = { description: string; quantity: number; unitCents: number; totalCents: number };

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    businessId: businessId(),
    number: text("number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    periodStart: tstz("period_start"),
    periodEnd: tstz("period_end"),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull().default([]),
    totalCents: integer("total_cents").notNull().default(0),
    issuedAt: tstz("issued_at"),
    dueAt: tstz("due_at"),
    paidAt: tstz("paid_at"),
    paymentMethod: paymentMethodEnum("payment_method"),
    paymentReference: text("payment_reference"),
    receiptUrl: text("receipt_url"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("invoices_number_unique").on(t.number), index().on(t.businessId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: businessId(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    kind: text("kind").$type<"subscription" | "deposit">().notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethodEnum("method").notNull(),
    provider: text("provider").notNull().default("manual"),
    providerRef: text("provider_ref"),
    status: text("status").$type<"pending" | "succeeded" | "failed" | "refunded">().notNull().default("pending"),
    paymentUrl: text("payment_url"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId), index().on(t.appointmentId)],
);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: id(),
    businessId: businessId(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text("status").$type<"scheduled" | "sent" | "rated" | "expired">().notNull().default("scheduled"),
    rating: smallint("rating"),
    feedback: text("feedback"),
    sentAt: tstz("sent_at"),
    respondedAt: tstz("responded_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId), uniqueIndex("review_requests_appt_unique").on(t.appointmentId)],
);

export type SegmentDefinition = {
  tags?: string[];
  noVisitDays?: number;
  minNoShows?: number;
  hasUpcoming?: boolean;
  serviceIds?: string[];
};

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    segment: jsonb("segment").$type<SegmentDefinition>().notNull().default({}),
    templateName: text("template_name").notNull(),
    variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
    status: text("status").$type<"draft" | "scheduled" | "sending" | "sent" | "cancelled">().notNull().default("draft"),
    scheduledAt: tstz("scheduled_at"),
    sentAt: tstz("sent_at"),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.businessId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<"user" | "ai" | "system" | "customer">().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.createdAt), index().on(t.entityType, t.entityId)],
);

/** Tables carrying business_id that must have RLS enabled (verified by tests). */
export const TENANT_TABLES = [
  "memberships",
  "locations",
  "resources",
  "staff",
  "services",
  "staff_services",
  "working_hours",
  "breaks",
  "time_off",
  "holidays",
  "customers",
  "conversations",
  "messages",
  "calls",
  "appointments",
  "notifications",
  "jobs",
  "usage_events",
  "subscriptions",
  "invoices",
  "payments",
  "review_requests",
  "campaigns",
  "audit_log",
] as const;

export type Business = typeof businesses.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentStatus = (typeof appointmentStatusEnum.enumValues)[number];
export type AppointmentSource = (typeof appointmentSourceEnum.enumValues)[number];
export type PlanTier = (typeof planTierEnum.enumValues)[number];
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type User = typeof users.$inferSelect;
export type Job = typeof jobs.$inferSelect;
