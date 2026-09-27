export interface WhatsAppProvider {
  sendApprovedTemplate(input: {
    to: string;
    template: string;
    variables: Record<string, string>;
    consentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  verifyWebhook(payload: string, signature: string): boolean;
}
export const whatsappStatus = {
  configured: false,
  label: "Neconfigurat",
} as const;
