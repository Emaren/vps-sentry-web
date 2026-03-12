import { Prisma } from "@prisma/client";

export type ShippingScopeInput = {
  userId: string;
  userEmail?: string | null;
  hostIds: string[];
};

function buildPayloadJsonContainsNeedle(key: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `"${key}":${JSON.stringify(value)}`;
}

export function buildShippingEventWhere(input: ShippingScopeInput): Prisma.NotificationEventWhereInput {
  const scopedOr: Prisma.NotificationEventWhereInput[] = [
    { endpoint: { is: { userId: input.userId } } },
  ];

  if (input.hostIds.length > 0) {
    scopedOr.push({ hostId: { in: input.hostIds } });
  }

  const accountLevelPayloadScopes: Prisma.NotificationEventWhereInput[] = [];
  const requestedByUserIdNeedle = buildPayloadJsonContainsNeedle("requestedByUserId", input.userId);
  if (requestedByUserIdNeedle) {
    accountLevelPayloadScopes.push({
      payloadJson: { contains: requestedByUserIdNeedle },
    });
  }

  const requestedByEmailNeedle = buildPayloadJsonContainsNeedle("requestedBy", input.userEmail ?? null);
  if (requestedByEmailNeedle) {
    accountLevelPayloadScopes.push({
      payloadJson: { contains: requestedByEmailNeedle },
    });
  }

  if (accountLevelPayloadScopes.length > 0) {
    scopedOr.push({
      AND: [
        { eventType: "notify.test" },
        { endpointId: null },
        { hostId: null },
        { OR: accountLevelPayloadScopes },
      ],
    });
  }

  return { OR: scopedOr };
}
