export function assertCreativeReplacementDelivery(
  context: { deliveryStatus: string; endsAt: string | null }, expectedEndTime?: string
) {
  if (!["ACTIVE","PAUSED","COMPLETED"].includes(context.deliveryStatus)) {
    throw new Error("Only Active, Paused or Completed ads can receive a replacement poster. Refresh the ad's current delivery state.");
  }
  const completed = context.deliveryStatus === "COMPLETED";
  if (completed || expectedEndTime) {
    if (!completed || !expectedEndTime || !context.endsAt || !Number.isFinite(Date.parse(expectedEndTime))
      || Date.parse(expectedEndTime) !== Date.parse(context.endsAt)) {
      throw new Error("This ad's schedule changed after the preview opened. Reopen Replace creative & run again before saving.");
    }
  }
  return completed;
}
