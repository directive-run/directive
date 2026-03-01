/**
 * Fraud Review Board — Mock Data & Case Builder
 *
 * Inline subset of fraud analysis mock data for server-side use.
 * Provides scenario lookup, deterministic risk scoring, and case summary formatting.
 */

// ============================================================================
// Types
// ============================================================================

export interface FlagEvent {
  id: string
  accountId: string
  merchant: string
  memo: string
  amount: number
  timestamp: string
  cardLast4: string
  location: string
}

export interface EnrichmentSignal {
  source: string
  risk: number
  detail: string
}

export interface DetectionRule {
  name: string
  description: string
  severity: 'critical' | 'major' | 'minor'
}

export interface Scenario {
  name: string
  description: string
  rules: DetectionRule[]
  events: FlagEvent[]
  enrichment: Record<string, EnrichmentSignal[]>
}

export interface FraudCase {
  id: string
  accountId: string
  events: FlagEvent[]
  signals: EnrichmentSignal[]
  riskScore: number
  severity: 'low' | 'medium' | 'high' | 'critical'
}

// ============================================================================
// Enrichment Database
// ============================================================================

const enrichmentDatabase: Record<string, EnrichmentSignal[]> = {
  'acct-1001': [
    { source: 'account-history', risk: 30, detail: '3 years, good standing' },
    { source: 'geo-risk', risk: 15, detail: 'Domestic transactions, consistent location' },
    { source: 'merchant-rep', risk: 60, detail: 'Merchant flagged for card-present fraud' },
  ],
  'acct-2002': [
    { source: 'account-history', risk: 70, detail: 'Recent password change, new device' },
    { source: 'geo-risk', risk: 85, detail: 'Transactions from 4 countries in 24h' },
    { source: 'merchant-rep', risk: 40, detail: 'Mixed merchant reputation' },
  ],
  'acct-3003': [
    { source: 'account-history', risk: 25, detail: '5 years, low activity until recently' },
    { source: 'geo-risk', risk: 20, detail: 'Single region' },
    { source: 'velocity-check', risk: 90, detail: 'Spend velocity 400% above 90-day average' },
  ],
  'acct-4004': [
    { source: 'account-history', risk: 45, detail: '1 year, moderate activity' },
    { source: 'geo-risk', risk: 35, detail: 'Two regions, consistent pattern' },
    { source: 'merchant-rep', risk: 50, detail: 'Standard merchants' },
  ],
  'acct-5005': [
    { source: 'account-history', risk: 10, detail: '10 years, excellent standing' },
    { source: 'geo-risk', risk: 10, detail: 'Single city' },
    { source: 'merchant-rep', risk: 15, detail: 'All verified merchants' },
  ],
  'acct-6001': [
    { source: 'account-history', risk: 40, detail: '2 years, moderate activity' },
    { source: 'geo-risk', risk: 20, detail: 'Single region, ACH deposits' },
    { source: 'name-verification', risk: 90, detail: 'Deposit originator names do not match account holder' },
  ],
  'acct-6002': [
    { source: 'account-history', risk: 85, detail: 'Account opened 3 weeks ago, no prior history' },
    { source: 'geo-risk', risk: 30, detail: 'Single city, domestic' },
    { source: 'velocity-check', risk: 95, detail: 'Deposit-withdrawal velocity 800% above baseline' },
  ],
  'acct-6003': [
    { source: 'account-history', risk: 55, detail: '1 year, low activity until recently' },
    { source: 'merchant-rep', risk: 70, detail: 'Refund volume exceeds purchase history' },
    { source: 'chargeback-history', risk: 80, detail: 'Multiple merchant-initiated credits with no matching debits' },
  ],
  'acct-6004': [
    { source: 'account-history', risk: 75, detail: '6 months, minimal legitimate activity' },
    { source: 'geo-risk', risk: 90, detail: 'All outgoing wires to high-risk international destinations' },
    { source: 'velocity-check', risk: 85, detail: 'Average dwell time under 2 hours for all funds' },
  ],
}

export function getMockEnrichment(accountId: string): EnrichmentSignal[] {
  return enrichmentDatabase[accountId] ?? [
    { source: 'account-history', risk: 50, detail: 'No enrichment data available' },
  ]
}

// ============================================================================
// Scenarios (16 total — 4 classic + 4 banking + 8 generated descriptions)
// ============================================================================

const scenarios: Record<string, Scenario> = {
  'card-skimming': {
    name: 'Card Skimming',
    description: 'A gas station processes 8 different credit cards in under an hour. Each transaction is a small fuel purchase, but every card number is different — the signature pattern of a skimming device installed on a payment terminal.',
    rules: [
      { name: 'Same-Merchant Clustering', description: 'Multiple cards used at the same merchant in a short window', severity: 'critical' },
      { name: 'Multi-Card Velocity', description: 'High number of distinct cards at a single terminal', severity: 'major' },
      { name: 'Small-Amount Probing', description: 'Repeated small charges consistent with card testing', severity: 'minor' },
    ],
    events: [
      { id: 'cs-001', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel purchase', amount: 75.00, timestamp: '2026-02-24T10:05:00Z', cardLast4: '4421', location: 'Houston, TX' },
      { id: 'cs-002', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel + snacks', amount: 42.50, timestamp: '2026-02-24T10:12:00Z', cardLast4: '8832', location: 'Houston, TX' },
      { id: 'cs-003', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel purchase', amount: 68.00, timestamp: '2026-02-24T10:18:00Z', cardLast4: '1190', location: 'Houston, TX' },
      { id: 'cs-004', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'car wash + fuel', amount: 95.00, timestamp: '2026-02-24T10:25:00Z', cardLast4: '5567', location: 'Houston, TX' },
      { id: 'cs-005', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel', amount: 55.00, timestamp: '2026-02-24T10:31:00Z', cardLast4: '3344', location: 'Houston, TX' },
      { id: 'cs-006', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel purchase', amount: 82.00, timestamp: '2026-02-24T10:38:00Z', cardLast4: '9901', location: 'Houston, TX' },
      { id: 'cs-007', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel + drinks', amount: 38.50, timestamp: '2026-02-24T10:44:00Z', cardLast4: '2278', location: 'Houston, TX' },
      { id: 'cs-008', accountId: 'acct-1001', merchant: 'QuickGas Station #47', memo: 'fuel purchase', amount: 71.00, timestamp: '2026-02-24T10:50:00Z', cardLast4: '6655', location: 'Houston, TX' },
    ],
    enrichment: { 'acct-1001': enrichmentDatabase['acct-1001']! },
  },

  'account-takeover': {
    name: 'Account Takeover',
    description: 'Five high-value purchases appear across four countries in a single day — Berlin, Paris, Tokyo, Dubai, Milan. The account holder\'s SSN and credit card number appear in transaction memos, suggesting compromised credentials being used for identity verification.',
    rules: [
      { name: 'Impossible Travel', description: 'Transactions from multiple countries within hours', severity: 'critical' },
      { name: 'PII Exposure', description: 'SSN or credit card numbers found in transaction memos', severity: 'critical' },
      { name: 'High-Value Burst', description: 'Multiple large purchases in rapid succession', severity: 'major' },
    ],
    events: [
      { id: 'at-001', accountId: 'acct-2002', merchant: 'ElectroMart Berlin', memo: 'laptop purchase ref SSN [REDACTED]', amount: 2499.99, timestamp: '2026-02-24T03:15:00Z', cardLast4: '7712', location: 'Berlin, DE' },
      { id: 'at-002', accountId: 'acct-2002', merchant: 'LuxWatch Paris', memo: 'timepiece — card [REDACTED]', amount: 8750.00, timestamp: '2026-02-24T06:30:00Z', cardLast4: '7712', location: 'Paris, FR' },
      { id: 'at-003', accountId: 'acct-2002', merchant: 'TechHub Tokyo', memo: 'electronics order', amount: 3200.00, timestamp: '2026-02-24T14:00:00Z', cardLast4: '7712', location: 'Tokyo, JP' },
      { id: 'at-004', accountId: 'acct-2002', merchant: 'GoldChain Dubai', memo: 'jewelry — acct [REDACTED]', amount: 12000.00, timestamp: '2026-02-24T18:45:00Z', cardLast4: '7712', location: 'Dubai, AE' },
      { id: 'at-005', accountId: 'acct-2002', merchant: 'DesignerBags Milan', memo: 'luxury goods purchase', amount: 5600.00, timestamp: '2026-02-24T22:10:00Z', cardLast4: '7712', location: 'Milan, IT' },
    ],
    enrichment: { 'acct-2002': enrichmentDatabase['acct-2002']! },
  },

  'bust-out': {
    name: 'Bust-Out Fraud',
    description: 'Over 12 days, spending escalates from a $15 deli lunch to a $15,000 wire transfer. Each purchase is slightly larger than the last — a classic bust-out where a fraudster builds trust with small transactions before draining the account.',
    rules: [
      { name: 'Amount Escalation', description: 'Transaction amounts increase steadily over time', severity: 'critical' },
      { name: 'Category Escalation', description: 'Purchases shift from low-risk to high-risk categories', severity: 'major' },
      { name: 'Velocity Increase', description: 'Transaction frequency accelerates toward the end', severity: 'minor' },
    ],
    events: [
      { id: 'bo-001', accountId: 'acct-3003', merchant: 'Corner Deli', memo: 'lunch', amount: 15.00, timestamp: '2026-02-10T12:00:00Z', cardLast4: '3301', location: 'Chicago, IL' },
      { id: 'bo-006', accountId: 'acct-3003', merchant: 'Jewelry Palace', memo: 'gold necklace', amount: 3500.00, timestamp: '2026-02-18T10:00:00Z', cardLast4: '3301', location: 'Chicago, IL' },
      { id: 'bo-009', accountId: 'acct-3003', merchant: 'WireTransfer Intl', memo: 'outgoing wire', amount: 8000.00, timestamp: '2026-02-20T08:00:00Z', cardLast4: '3301', location: 'Chicago, IL' },
      { id: 'bo-011', accountId: 'acct-3003', merchant: 'WireTransfer Intl', memo: 'outgoing wire #2', amount: 15000.00, timestamp: '2026-02-21T07:00:00Z', cardLast4: '3301', location: 'Chicago, IL' },
    ],
    enrichment: { 'acct-3003': enrichmentDatabase['acct-3003']! },
  },

  'mixed-batch': {
    name: 'Mixed Batch',
    description: 'Three accounts with very different risk profiles: one with routine grocery and Netflix charges, one with luxury jewelry purchases, and one making offshore wire transfers. Shows how the system handles mixed legitimate and suspicious activity in a single batch.',
    rules: [
      { name: 'Cross-Account Risk Variance', description: 'Wide spread in risk scores across accounts in the same batch', severity: 'major' },
      { name: 'High-Value Outliers', description: 'Individual transactions far exceeding account baseline', severity: 'major' },
      { name: 'Legitimate Baseline', description: 'Normal spending patterns providing comparison context', severity: 'minor' },
    ],
    events: [
      { id: 'mb-003', accountId: 'acct-4004', merchant: 'ShadyElectronics', memo: 'bulk phones — SSN [REDACTED]', amount: 4500.00, timestamp: '2026-02-24T10:00:00Z', cardLast4: '4401', location: 'Austin, TX' },
      { id: 'mb-006', accountId: 'acct-2002', merchant: 'HighEnd Jewelers', memo: 'diamond ring', amount: 15000.00, timestamp: '2026-02-24T11:00:00Z', cardLast4: '7712', location: 'New York, NY' },
      { id: 'mb-008', accountId: 'acct-5005', merchant: 'Grocery Mart', memo: 'weekly groceries', amount: 67.30, timestamp: '2026-02-24T16:00:00Z', cardLast4: '5501', location: 'Denver, CO' },
      { id: 'mb-014', accountId: 'acct-2002', merchant: 'Offshore Trading Co', memo: 'investment wire', amount: 25000.00, timestamp: '2026-02-24T14:00:00Z', cardLast4: '7712', location: 'Cayman Islands' },
    ],
    enrichment: {
      'acct-4004': enrichmentDatabase['acct-4004']!,
      'acct-2002': enrichmentDatabase['acct-2002']!,
      'acct-5005': enrichmentDatabase['acct-5005']!,
    },
  },

  'deposit-name-mismatch': {
    name: 'Deposit Name Mismatch',
    description: "Incoming ACH deposits arrive from 'Johnson Industries LLC' and 'M. Rodriguez DBA QuickCash', but the account belongs to 'Sarah Chen'. None of the deposit originator names match the account holder — a red flag for money mule activity or payroll fraud.",
    rules: [
      { name: 'Name Mismatch', description: 'Deposit originator names do not match account holder', severity: 'critical' },
      { name: 'Multiple Originators', description: 'Deposits from several unrelated entities to one account', severity: 'major' },
      { name: 'Structuring Pattern', description: 'Amounts cluster just below the $10,000 reporting threshold', severity: 'minor' },
    ],
    events: [
      { id: 'dnm-001', accountId: 'acct-6001', merchant: 'ACH Deposit — Johnson Industries LLC', memo: 'payroll deposit', amount: 4800.00, timestamp: '2026-02-20T08:00:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'dnm-002', accountId: 'acct-6001', merchant: 'ACH Deposit — M. Rodriguez DBA QuickCash', memo: 'vendor payment', amount: 9500.00, timestamp: '2026-02-20T14:30:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'dnm-004', accountId: 'acct-6001', merchant: 'ACH Deposit — QuickCash Services', memo: 'consulting fee', amount: 9800.00, timestamp: '2026-02-21T16:00:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'dnm-005', accountId: 'acct-6001', merchant: 'ACH Deposit — R. Patel Enterprises', memo: 'invoice payment', amount: 7500.00, timestamp: '2026-02-22T10:00:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'dnm-007', accountId: 'acct-6001', merchant: 'ACH Deposit — M. Rodriguez DBA QuickCash', memo: 'service payment', amount: 9400.00, timestamp: '2026-02-23T08:30:00Z', cardLast4: '0000', location: 'ACH Network' },
    ],
    enrichment: { 'acct-6001': enrichmentDatabase['acct-6001']! },
  },

  'cash-in-cash-out': {
    name: 'Cash In / Cash Out',
    description: 'A new account receives three large cash deposits totaling $28,000 over two days. Within hours of each deposit, nearly the same amount is withdrawn via ATM or wire — leaving the account near zero each time. The rapid deposit-withdrawal cycle is a hallmark of money laundering.',
    rules: [
      { name: 'High-Velocity Cash Movement', description: 'Large cash deposits immediately followed by withdrawals', severity: 'critical' },
      { name: 'Deposit-Withdrawal Symmetry', description: 'Withdrawal amounts closely match preceding deposits', severity: 'critical' },
      { name: 'New Account Risk', description: 'Account opened within the last 30 days with unusual activity', severity: 'major' },
    ],
    events: [
      { id: 'cico-001', accountId: 'acct-6002', merchant: 'Branch Deposit', memo: 'cash deposit', amount: 9500.00, timestamp: '2026-02-22T09:00:00Z', cardLast4: '0000', location: 'Chicago, IL' },
      { id: 'cico-002', accountId: 'acct-6002', merchant: 'Chase ATM #401', memo: 'cash withdrawal', amount: 5000.00, timestamp: '2026-02-22T11:30:00Z', cardLast4: '6201', location: 'Chicago, IL' },
      { id: 'cico-003', accountId: 'acct-6002', merchant: 'WireTransfer Intl', memo: 'outgoing wire', amount: 4200.00, timestamp: '2026-02-22T13:00:00Z', cardLast4: '0000', location: 'Chicago, IL' },
      { id: 'cico-004', accountId: 'acct-6002', merchant: 'Branch Deposit', memo: 'cash deposit', amount: 8500.00, timestamp: '2026-02-22T15:00:00Z', cardLast4: '0000', location: 'Chicago, IL' },
      { id: 'cico-007', accountId: 'acct-6002', merchant: 'Branch Deposit', memo: 'cash deposit', amount: 10000.00, timestamp: '2026-02-23T09:30:00Z', cardLast4: '0000', location: 'Chicago, IL' },
      { id: 'cico-010', accountId: 'acct-6002', merchant: 'WireTransfer Intl', memo: 'outgoing wire — final', amount: 1800.00, timestamp: '2026-02-23T14:00:00Z', cardLast4: '0000', location: 'Chicago, IL' },
    ],
    enrichment: { 'acct-6002': enrichmentDatabase['acct-6002']! },
  },

  'merchant-credit-abuse': {
    name: 'Merchant Credit Abuse',
    description: 'An account receives $47,000 in merchant refund credits from six different retailers over two weeks, but there are zero corresponding purchase debits. Credits without purchases suggest return fraud at scale, collusion with merchants, or compromised merchant terminals.',
    rules: [
      { name: 'Credits Without Debits', description: 'Refund credits with no matching purchase transactions', severity: 'critical' },
      { name: 'Multi-Merchant Refunds', description: 'Refunds from multiple unrelated merchants to one account', severity: 'major' },
      { name: 'Refund Velocity', description: 'High frequency of refund credits in a short period', severity: 'major' },
    ],
    events: [
      { id: 'mca-001', accountId: 'acct-6003', merchant: 'BestBuy — Refund', memo: 'return credit — electronics', amount: 8500.00, timestamp: '2026-02-12T10:00:00Z', cardLast4: '6301', location: 'Dallas, TX' },
      { id: 'mca-003', accountId: 'acct-6003', merchant: 'Nordstrom — Refund', memo: 'return credit — clothing', amount: 12000.00, timestamp: '2026-02-15T09:00:00Z', cardLast4: '6301', location: 'Dallas, TX' },
      { id: 'mca-005', accountId: 'acct-6003', merchant: 'Costco — Refund', memo: 'return credit — bulk order', amount: 5600.00, timestamp: '2026-02-18T13:00:00Z', cardLast4: '6301', location: 'Dallas, TX' },
      { id: 'mca-009', accountId: 'acct-6003', merchant: 'Target — Refund', memo: 'return credit — appliances', amount: 4800.00, timestamp: '2026-02-23T16:00:00Z', cardLast4: '6301', location: 'Dallas, TX' },
    ],
    enrichment: { 'acct-6003': enrichmentDatabase['acct-6003']! },
  },

  'rapid-funds-movement': {
    name: 'Rapid Funds Movement',
    description: 'Money arrives via ACH, sits for under 2 hours, then leaves via wire transfer to an overseas account. This pattern repeats 5 times in a single week, each time with a different originator. The account is being used as a pass-through — funds never stay long enough for legitimate use.',
    rules: [
      { name: 'Pass-Through Pattern', description: 'Funds received and forwarded with minimal dwell time', severity: 'critical' },
      { name: 'Short Dwell Time', description: 'Funds remain in account for less than 2 hours before transfer', severity: 'critical' },
      { name: 'Multi-Originator', description: 'Incoming funds from multiple unrelated sources', severity: 'major' },
      { name: 'International Wire Destination', description: 'Outgoing wires routed to overseas accounts', severity: 'major' },
    ],
    events: [
      { id: 'rfm-001', accountId: 'acct-6004', merchant: 'ACH Deposit — Apex Trading LLC', memo: 'business payment', amount: 15000.00, timestamp: '2026-02-18T08:00:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'rfm-002', accountId: 'acct-6004', merchant: 'WireTransfer Intl', memo: 'outgoing wire — Hong Kong', amount: 14800.00, timestamp: '2026-02-18T09:30:00Z', cardLast4: '0000', location: 'New York, NY' },
      { id: 'rfm-003', accountId: 'acct-6004', merchant: 'ACH Deposit — GlobalTech Solutions', memo: 'consulting fee', amount: 22000.00, timestamp: '2026-02-19T10:15:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'rfm-004', accountId: 'acct-6004', merchant: 'WireTransfer Intl', memo: 'outgoing wire — Singapore', amount: 21500.00, timestamp: '2026-02-19T11:45:00Z', cardLast4: '0000', location: 'New York, NY' },
      { id: 'rfm-007', accountId: 'acct-6004', merchant: 'ACH Deposit — Pacific Rim Holdings', memo: 'distribution payment', amount: 31000.00, timestamp: '2026-02-22T08:30:00Z', cardLast4: '0000', location: 'ACH Network' },
      { id: 'rfm-008', accountId: 'acct-6004', merchant: 'WireTransfer Intl', memo: 'outgoing wire — Cayman Islands', amount: 30500.00, timestamp: '2026-02-22T10:00:00Z', cardLast4: '0000', location: 'New York, NY' },
    ],
    enrichment: { 'acct-6004': enrichmentDatabase['acct-6004']! },
  },

  'synthetic-identity': {
    name: 'Synthetic Identity',
    description: 'Sixty transactions spread across 12 accounts that were all opened within the same month, shopping at unrelated merchants across multiple regions. The spending patterns are too diverse and too consistent — synthetic identities built from stolen SSNs and fabricated personal details.',
    rules: [
      { name: 'Coordinated Account Creation', description: 'Multiple accounts opened in the same timeframe with similar patterns', severity: 'critical' },
      { name: 'Identity Fabrication', description: "PII combinations that don't match known identity databases", severity: 'critical' },
      { name: 'Diverse Merchant Spread', description: 'Unusually wide variety of merchant categories for new accounts', severity: 'major' },
    ],
    events: [],
    enrichment: {},
  },

  'friendly-fraud': {
    name: 'Friendly Fraud',
    description: "A customer disputes 35 subscription charges and retail purchases over six accounts, claiming they never authorized any of them. The transactions all used the customer's real card, real device, and real IP address — this is first-party friendly fraud, not unauthorized access.",
    rules: [
      { name: 'First-Party Dispute Pattern', description: "Disputes filed on transactions matching the account holder's known devices", severity: 'critical' },
      { name: 'Multi-Account Dispute', description: 'Same individual disputing charges across multiple accounts', severity: 'major' },
      { name: 'Subscription Abuse', description: 'Repeated subscription sign-up and dispute cycles', severity: 'minor' },
    ],
    events: [],
    enrichment: {},
  },

  'money-laundering': {
    name: 'Money Laundering',
    description: 'Eighty transactions moving money through 8 accounts via wire transfers, crypto exchanges, and ATM withdrawals. Amounts escalate from $500 to $50,000, hopping between global cities. The layering pattern is textbook anti-money-laundering (AML) territory.',
    rules: [
      { name: 'Layering Pattern', description: 'Funds moved through multiple accounts and transaction types to obscure origin', severity: 'critical' },
      { name: 'Cross-Border Movement', description: 'Transactions spanning multiple countries and jurisdictions', severity: 'critical' },
      { name: 'Amount Escalation', description: 'Transaction amounts increase significantly over time', severity: 'major' },
    ],
    events: [],
    enrichment: {},
  },

  'credential-stuffing': {
    name: 'Credential Stuffing',
    description: 'One hundred small online purchases burst across 20 accounts in a 4-hour window, each using a different credit card. Automated bots are testing stolen card numbers at scale — the purchases are just validation checks before the real fraud begins.',
    rules: [
      { name: 'Automated Burst Pattern', description: 'High volume of transactions in a very short time window', severity: 'critical' },
      { name: 'Card Number Rotation', description: 'Each transaction uses a different card number', severity: 'critical' },
      { name: 'Validation Probing', description: 'Small amounts consistent with card-testing behavior', severity: 'major' },
    ],
    events: [],
    enrichment: {},
  },

  'return-fraud': {
    name: 'Return Fraud',
    description: 'Forty-five purchases at electronics and retail stores, all on the same card, with suspicious amount spikes between routine buys. The pattern suggests purchasing items specifically to return them for cash or store credit at inflated values.',
    rules: [
      { name: 'Purchase-Return Cycling', description: 'Items purchased and returned repeatedly at the same merchants', severity: 'critical' },
      { name: 'Amount Spike Pattern', description: 'Large purchases interspersed with small routine transactions', severity: 'major' },
      { name: 'Single-Card Concentration', description: 'All activity on one card across multiple merchants', severity: 'minor' },
    ],
    events: [],
    enrichment: {},
  },

  'first-party-fraud': {
    name: 'First-Party Fraud',
    description: 'Fifty transactions across 4 accounts buying luxury goods and making ATM withdrawals, with amounts escalating to $25,000. Forty percent of memos contain PII — SSNs, bank account numbers — suggesting the account holders are intentionally creating a paper trail for a false identity claim.',
    rules: [
      { name: 'Intentional PII Exposure', description: 'Unusually high rate of PII in transaction memos (40%+)', severity: 'critical' },
      { name: 'Luxury Escalation', description: 'Purchases shift from routine items to high-value luxury goods', severity: 'major' },
      { name: 'ATM Cash Extraction', description: 'Large ATM withdrawals interspersed with card purchases', severity: 'major' },
    ],
    events: [],
    enrichment: {},
  },

  'geo-anomaly': {
    name: 'Geographic Anomaly',
    description: "Forty transactions across 6 accounts showing physically impossible travel — purchases in London, then Tokyo, then S\u00e3o Paulo within hours. The timing and geography don't add up, pointing to cloned cards being used simultaneously across continents.",
    rules: [
      { name: 'Impossible Travel', description: 'Transactions in distant cities within physically impossible timeframes', severity: 'critical' },
      { name: 'High-Risk Jurisdiction', description: 'Transactions originating from flagged geographic regions', severity: 'major' },
      { name: 'Simultaneous Multi-Location', description: 'Same card used at multiple locations at overlapping times', severity: 'major' },
    ],
    events: [],
    enrichment: {},
  },

  'micro-transaction': {
    name: 'Micro Transaction Probe',
    description: 'Seventy tiny transactions ($0.50\u2013$15) spread across 15 accounts. Individually they look harmless — a coffee here, a parking meter there. But the volume and pattern suggest card-testing probes: verify the card works with a micro-charge before escalating.',
    rules: [
      { name: 'Micro-Amount Pattern', description: 'High volume of very small transactions across many accounts', severity: 'major' },
      { name: 'Card Testing Indicators', description: 'Small charges consistent with automated card validation', severity: 'major' },
      { name: 'Low-Risk Camouflage', description: 'Transaction types designed to blend with legitimate activity', severity: 'minor' },
    ],
    events: [],
    enrichment: {},
  },
}

// ============================================================================
// Deterministic Risk Scoring (same formula as system example)
// ============================================================================

export function analyzeWithFormula(fraudCase: FraudCase): {
  riskScore: number
  severity: 'low' | 'medium' | 'high' | 'critical'
} {
  const avgSignalRisk =
    fraudCase.signals.length > 0
      ? fraudCase.signals.reduce((sum, s) => sum + s.risk, 0) / fraudCase.signals.length
      : 50

  const totalAmount = fraudCase.events.reduce((sum, e) => sum + e.amount, 0)
  const amountFactor = Math.min(totalAmount / 10000, 1) * 30
  const eventFactor = Math.min(fraudCase.events.length / 10, 1) * 20

  const riskScore = Math.min(100, Math.round(avgSignalRisk * 0.5 + amountFactor + eventFactor))

  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low'
  if (riskScore >= 80) {
    severity = 'critical'
  } else if (riskScore >= 60) {
    severity = 'high'
  } else if (riskScore >= 40) {
    severity = 'medium'
  }

  return { riskScore, severity }
}

// ============================================================================
// Scenario Lookup & Case Builder
// ============================================================================

const SCENARIO_KEYWORDS: Record<string, string[]> = {
  'card-skimming': ['card skimming', 'skimming', 'gas station', 'skimmer'],
  'account-takeover': ['account takeover', 'takeover', 'ato', 'compromised'],
  'bust-out': ['bust out', 'bust-out', 'bustout', 'escalation'],
  'mixed-batch': ['mixed batch', 'mixed', 'batch'],
  'deposit-name-mismatch': ['deposit name', 'name mismatch', 'mismatch', 'ach deposit', 'money mule'],
  'cash-in-cash-out': ['cash in cash out', 'cash in/cash out', 'cico', 'deposit withdrawal'],
  'merchant-credit-abuse': ['merchant credit', 'credit abuse', 'refund fraud', 'return credit'],
  'rapid-funds-movement': ['rapid funds', 'pass-through', 'pass through', 'funds movement'],
  'synthetic-identity': ['synthetic identity', 'synthetic', 'fake identity'],
  'friendly-fraud': ['friendly fraud', 'friendly', 'dispute'],
  'money-laundering': ['money laundering', 'laundering', 'aml'],
  'credential-stuffing': ['credential stuffing', 'credential', 'bot', 'stuffing'],
  'return-fraud': ['return fraud', 'return', 'refund'],
  'first-party-fraud': ['first party', 'first-party', 'pii exposure'],
  'geo-anomaly': ['geo anomaly', 'geographic', 'impossible travel'],
  'micro-transaction': ['micro transaction', 'micro', 'card testing'],
}

export function findScenario(userMessage: string): string | null {
  const lower = userMessage.toLowerCase()

  for (const [key, keywords] of Object.entries(SCENARIO_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return key
      }
    }
  }

  return null
}

export function buildCaseSummary(scenarioKey: string): string {
  const scenario = scenarios[scenarioKey]
  if (!scenario) {
    return 'Unknown scenario. Available: ' + Object.keys(scenarios).join(', ')
  }

  // Build a case from the scenario
  const accountIds = [...new Set(scenario.events.map((e) => e.accountId))]
  const primaryAccount = accountIds[0] ?? 'unknown'

  // Collect enrichment signals
  const signals: EnrichmentSignal[] = []
  for (const acctId of accountIds) {
    const acctSignals = scenario.enrichment[acctId] ?? getMockEnrichment(acctId)
    signals.push(...acctSignals)
  }

  // Score the case
  const fraudCase: FraudCase = {
    id: 'case-001',
    accountId: primaryAccount,
    events: scenario.events,
    signals,
    riskScore: 0,
    severity: 'low',
  }
  const { riskScore, severity } = analyzeWithFormula(fraudCase)

  // Format rules
  const rulesText = scenario.rules
    .map((r) => `  - [${r.severity.toUpperCase()}] ${r.name}: ${r.description}`)
    .join('\n')

  // Format transactions
  const txnLines = scenario.events.map((e, i) => {
    const time = new Date(e.timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC')

    return `  ${i + 1}. $${e.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} — ${e.merchant} (${e.location}) — ${time}`
  }).join('\n')

  // Format enrichment signals
  const signalLines = signals.map((s) =>
    `  - ${s.source}: risk ${s.risk} — ${s.detail}`,
  ).join('\n')

  const totalAmount = scenario.events.reduce((sum, e) => sum + e.amount, 0)

  return `FRAUD INVESTIGATION REPORT — Case #case-001
${'━'.repeat(50)}
Scenario: ${scenario.name}
Account: ${primaryAccount}
Total Amount: $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
Preliminary Risk Score: ${riskScore}/100 (${severity.charAt(0).toUpperCase() + severity.slice(1)})

SCENARIO DESCRIPTION:
${scenario.description}

DETECTION RULES TRIGGERED:
${rulesText}

TRANSACTIONS (${scenario.events.length}):
${txnLines}

ENRICHMENT SIGNALS:
${signalLines}

Investigate this case. Assign your specialist analysts and produce a findings report with critical/major/minor classifications.`
}

export function getScenarioList(): string[] {
  return Object.keys(scenarios)
}
