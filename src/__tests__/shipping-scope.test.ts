import { describe, expect, it } from "vitest";
import { buildShippingEventWhere } from "@/app/dashboard/_lib/shipping-scope";

describe("buildShippingEventWhere", () => {
  it("includes host, endpoint, and account-level notify test ownership", () => {
    expect(
      buildShippingEventWhere({
        userId: "user_1",
        userEmail: "owner@example.com",
        hostIds: ["host_1"],
      })
    ).toEqual({
      OR: [
        { endpoint: { is: { userId: "user_1" } } },
        { hostId: { in: ["host_1"] } },
        {
          AND: [
            { eventType: "notify.test" },
            { endpointId: null },
            { hostId: null },
            {
              OR: [
                { payloadJson: { contains: '"requestedByUserId":"user_1"' } },
                { payloadJson: { contains: '"requestedBy":"owner@example.com"' } },
              ],
            },
          ],
        },
      ],
    });
  });

  it("omits the email matcher when no email is available", () => {
    expect(
      buildShippingEventWhere({
        userId: "user_2",
        userEmail: null,
        hostIds: [],
      })
    ).toEqual({
      OR: [
        { endpoint: { is: { userId: "user_2" } } },
        {
          AND: [
            { eventType: "notify.test" },
            { endpointId: null },
            { hostId: null },
            {
              OR: [{ payloadJson: { contains: '"requestedByUserId":"user_2"' } }],
            },
          ],
        },
      ],
    });
  });
});
