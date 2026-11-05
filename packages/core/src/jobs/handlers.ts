/** Registers every job handler. Call once per process before `runDueJobs`. */
import { NOTIFY_JOB } from "../booking/service";
import { handleAppointmentNotification } from "../notifications/send";
import { registerJobHandler } from "./queue";

let registered = false;

export function registerDefaultJobHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler(NOTIFY_JOB, handleAppointmentNotification);
}
