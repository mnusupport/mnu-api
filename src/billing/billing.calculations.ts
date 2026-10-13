export interface BillingCalculationInput {
  subtotal: number;
  taxConfigured: boolean;
  taxRatePercent: number;
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
  serviceChargeEnabled: boolean;
  serviceChargePercent: number | null | undefined;
}
export interface BillingCalculationResult {
  subtotal: number; discountAmount: number; serviceChargeAmount: number;
  taxableAmount: number; taxRatePercent: number; taxAmount: number; total: number;
}
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Splits a tax amount into equal central/state halves for an intra-state supply (a restaurant serving
 * on its own premises or handing over takeaway at its own counter). The two halves always add back to
 * the total tax exactly. This is a presentation split of the single configured rate, not a legal
 * determination — inter-state / IGST supplies are not modelled.
 */
export function splitIntraStateTax(taxAmount: number, ratePercent: number) {
  const cgst = roundMoney(taxAmount / 2);
  const sgst = roundMoney(taxAmount - cgst);
  const halfRate = roundMoney(ratePercent / 2);
  return { cgst: { ratePercent: halfRate, amount: cgst }, sgst: { ratePercent: roundMoney(ratePercent - halfRate), amount: sgst } };
}

/** Pure billing math: only explicitly configured tax/charge settings are applied. */
export function calculateBillTotals(input: BillingCalculationInput): BillingCalculationResult {
  if (!Number.isFinite(input.subtotal) || input.subtotal < 0) throw new Error('Subtotal must be a non-negative finite amount.');
  if (input.taxConfigured && (!Number.isFinite(input.taxRatePercent) || input.taxRatePercent < 0 || input.taxRatePercent > 100)) throw new Error('Configured tax percentage is invalid.');
  if (input.serviceChargeEnabled && (typeof input.serviceChargePercent !== 'number' || !Number.isFinite(input.serviceChargePercent) || input.serviceChargePercent < 0 || input.serviceChargePercent > 100)) throw new Error('Service charge percentage is missing or invalid.');
  const subtotal = roundMoney(input.subtotal);
  const discountAmount = 0; // No persisted discount amount/rule exists in the current order model.
  const serviceChargeAmount = roundMoney(subtotal * ((input.serviceChargeEnabled ? input.serviceChargePercent ?? 0 : 0) / 100));
  const taxRatePercent = input.taxConfigured ? input.taxRatePercent : 0;
  const grossBeforeTax = roundMoney(subtotal - discountAmount + serviceChargeAmount);
  let taxableAmount = grossBeforeTax;
  let taxAmount = 0;
  let total = grossBeforeTax;
  if (input.taxConfigured && taxRatePercent > 0) {
    if (input.taxMode === 'INCLUSIVE') {
      taxAmount = roundMoney(grossBeforeTax * taxRatePercent / (100 + taxRatePercent));
      taxableAmount = roundMoney(grossBeforeTax - taxAmount);
      total = grossBeforeTax;
    } else {
      taxableAmount = grossBeforeTax;
      taxAmount = roundMoney(taxableAmount * taxRatePercent / 100);
      total = roundMoney(taxableAmount + taxAmount);
    }
  }
  return { subtotal, discountAmount, serviceChargeAmount, taxableAmount, taxRatePercent, taxAmount, total };
}
