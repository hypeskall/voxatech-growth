import "server-only";
import { admin, check } from "../db";
export interface NotificationProvider {
  notify(input: {
    organization: string;
    title: string;
    body: string;
    key: string;
  }): Promise<void>;
}
export class InAppNotifications implements NotificationProvider {
  async notify(input: Parameters<NotificationProvider["notify"]>[0]) {
    check(
      await admin().from("notifications").upsert(
        {
          organization_id: input.organization,
          title: input.title,
          body: input.body,
          idempotency_key: input.key,
        },
        {
          onConflict: "organization_id,idempotency_key",
          ignoreDuplicates: true,
        },
      ),
    );
  }
}
