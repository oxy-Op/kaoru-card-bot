export interface PurchaseEvent {
  userDiscordId: string;
  username: string;
  petals: number;
  idempotencyKey: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;
  validateAndNormalize(payload: unknown): Promise<PurchaseEvent>;
}
