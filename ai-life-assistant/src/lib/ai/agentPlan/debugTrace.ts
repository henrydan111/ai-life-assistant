import type { ConfirmationTrace } from "@/lib/confirmation/resolvePendingConfirmations";

export type DebugTraceRequest = {
  debugTrace?: boolean;
};

export function confirmationTraceMeta(
  body: DebugTraceRequest,
  result?: { confirmationTrace?: ConfirmationTrace[] } | null
) {
  return body.debugTrace === true && result?.confirmationTrace
    ? { confirmationTrace: result.confirmationTrace }
    : {};
}

export function withoutConfirmationTrace<T extends { confirmationTrace?: unknown }>(value: T) {
  const { confirmationTrace: _confirmationTrace, ...rest } = value;
  return rest;
}
