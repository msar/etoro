/**
 * Shared broker catalog — which integrations exist and how they connect.
 */

export type BrokerId = 'etoro' | 'abnamro' | 'etrade' | 'kraken';

export interface BrokerMeta {
  id: BrokerId;
  displayName: string;
  href: string;
  currency: string;
  /** How the user connects this broker */
  connectMode: 'api' | 'upload';
  description: string;
}

export const BROKER_CATALOG: BrokerMeta[] = [
  {
    id: 'etoro',
    displayName: 'eToro',
    href: '/etoro',
    currency: 'USD',
    connectMode: 'api',
    description: 'Live portfolio via eToro Public API keys',
  },
  {
    id: 'abnamro',
    displayName: 'ABN AMRO Guided Investing',
    href: '/abnamro',
    currency: 'EUR',
    connectMode: 'upload',
    description: 'Import quarterly Portfolio summary PDFs',
  },
  {
    id: 'etrade',
    displayName: 'E*TRADE',
    href: '/etrade',
    currency: 'USD',
    connectMode: 'upload',
    description: 'Client Statement PDFs and Gains & Losses exports',
  },
  {
    id: 'kraken',
    displayName: 'Kraken',
    href: '/kraken',
    currency: 'USD',
    connectMode: 'api',
    description: 'Spot balances via Kraken REST API key + private key',
  },
];

export const BROKER_IDS: BrokerId[] = BROKER_CATALOG.map((b) => b.id);

export function isBrokerId(value: string): value is BrokerId {
  return (BROKER_IDS as string[]).includes(value);
}

export function brokerMeta(id: BrokerId): BrokerMeta {
  const found = BROKER_CATALOG.find((b) => b.id === id);
  if (!found) throw new Error(`Unknown broker: ${id}`);
  return found;
}
