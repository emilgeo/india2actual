import { stringify } from 'csv-stringify/sync';

export function hsbcDescription(
  merchant: string,
  date = '11/03/2025',
): string {
  return `${merchant} ${date} •••• •••• •••• 0000`;
}

export function hsbcRows(): string[][] {
  return [
    ['12/03/2025', hsbcDescription('ACME STORE           PUNE IN'), '-725.00'],
    ['14/03/2025', hsbcDescription('NEFT PAYMENT RECEIVED', '13/03/2025'), '1,430.00'],
    ['15/03/2025', hsbcDescription('ACME STORE REFUND', '14/03/2025'), '120.00'],
    ['16/03/2025', hsbcDescription('ACME STORE REVERSAL', '15/03/2025'), '75.00'],
    ['17/03/2025', hsbcDescription('SWIGGY PUNE IN', '16/03/2025'), '-430.00'],
  ];
}

export function hsbcCsv(rows = hsbcRows()): string {
  return stringify(rows);
}
