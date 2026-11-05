import type { AppointmentView } from "@fekerte/core/booking/service";
import type { AppointmentSource, AppointmentStatus, Locale, Service, Staff } from "@fekerte/core/db/schema";
import { pickLocalized } from "@fekerte/core/lib/i18n";

/** Serializable appointment shape passed to client components. */
export type ApptDTO = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  staffId: string;
  staffName: string;
  staffColor: string;
  serviceId: string;
  serviceName: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  notes: string | null;
  internalNotes: string | null;
  priceCents: number | null;
  depositStatus: "none" | "required" | "paid" | "waived" | "refunded";
  depositCents: number;
  depositDueAt: string | null;
};

export function toApptDTO(a: AppointmentView, locale: Locale): ApptDTO {
  return {
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    source: a.source,
    staffId: a.staffId,
    staffName: a.staffName,
    staffColor: a.staffColor,
    serviceId: a.serviceId,
    serviceName: pickLocalized(a.serviceName, locale),
    customerId: a.customerId,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    notes: a.notes,
    internalNotes: a.internalNotes,
    priceCents: a.priceCents,
    depositStatus: a.depositStatus,
    depositCents: a.depositCents,
    depositDueAt: a.depositDueAt?.toISOString() ?? null,
  };
}

export type ServiceOption = { id: string; name: string; durationMinutes: number; priceCents: number | null; staffIds: string[] };
export type StaffOption = { id: string; name: string; color: string };

export function toServiceOptions(services: Service[], links: { staffId: string; serviceId: string }[], locale: Locale): ServiceOption[] {
  return services
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      name: pickLocalized(s.name, locale),
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId),
    }));
}

export function toStaffOptions(staff: Staff[]): StaffOption[] {
  return staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, color: s.color }));
}
