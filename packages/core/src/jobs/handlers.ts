/** Registers every job handler. Call once per process before `runDueJobs`. */
import { NOTIFY_JOB } from "../booking/service";
import { handleAppointmentNotification } from "../notifications/send";
import { registerJobHandler } from "./queue";
import { handleWhatsAppReplyJob, WHATSAPP_REPLY_JOB } from "../channels/whatsapp";
import { registerRecurringHandlers } from "./scheduler";

let registered = false;

export function registerDefaultJobHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler(NOTIFY_JOB, handleAppointmentNotification);
  registerJobHandler(WHATSAPP_REPLY_JOB, handleWhatsAppReplyJob);
  registerRecurringHandlers();
}
