/** Registers every job handler. Call once per process before `runDueJobs`. */
import { NOTIFY_JOB } from "../booking/service";
import { handleAppointmentNotification } from "../notifications/send";
import { registerJobHandler } from "./queue";
import { handleWhatsAppReplyJob, WHATSAPP_REPLY_JOB } from "../channels/whatsapp";
import { registerRecurringHandlers } from "./scheduler";
import { DEPOSIT_EXPIRE_JOB, handleDepositExpireJob } from "../growth/deposits";
import { handleReviewRequestJob, REVIEW_REQUEST_JOB } from "../growth/reviews";
import { handleRecallJob, RECALL_JOB } from "../growth/recalls";
import { CAMPAIGN_JOB, handleCampaignJob } from "../growth/campaigns";

let registered = false;

export function registerDefaultJobHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler(NOTIFY_JOB, handleAppointmentNotification);
  registerJobHandler(WHATSAPP_REPLY_JOB, handleWhatsAppReplyJob);
  registerJobHandler(DEPOSIT_EXPIRE_JOB, handleDepositExpireJob);
  registerJobHandler(REVIEW_REQUEST_JOB, handleReviewRequestJob);
  registerJobHandler(RECALL_JOB, handleRecallJob);
  registerJobHandler(CAMPAIGN_JOB, handleCampaignJob);
  registerRecurringHandlers();
}
