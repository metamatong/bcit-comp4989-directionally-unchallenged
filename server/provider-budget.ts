/** Rolling application request ceilings, including retries; not provider entitlements. */
import { ProviderError } from './provider';

export type ProviderBudgetOptions = {
  requestsPerMinute: number;
  requestsPerDay: number;
  reserveSharedBudget?: (minute: number, day: number) => Promise<void>;
};

export class ProviderBudget {
  private attempts: number[] = [];
  constructor(private options: ProviderBudgetOptions) {}

  async reserve(): Promise<void> {
    if (this.options.reserveSharedBudget) {
      await this.options.reserveSharedBudget(
        this.options.requestsPerMinute,
        this.options.requestsPerDay,
      );
      return;
    }
    const now = Date.now();
    this.attempts = this.attempts.filter((time) => now - time < 86400000);
    const minute = this.attempts.filter((time) => now - time < 60000);
    const retryAt = Math.max(
      minute.length >= this.options.requestsPerMinute ? minute[0] + 60000 : 0,
      this.attempts.length >= this.options.requestsPerDay ? this.attempts[0] + 86400000 : 0,
    );
    if (retryAt) {
      const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
      throw new ProviderError(
        `AI request budget reached. Try again in ${seconds} seconds.`,
        429,
        'budget',
        true,
        seconds,
      );
    }
    this.attempts.push(now);
  }
}
