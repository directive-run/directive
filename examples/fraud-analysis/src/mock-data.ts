/**
 * Fraud Analysis — Mock Data & Types
 *
 * Twelve fraud scenarios (4 hand-crafted + 8 generated) with mock enrichment data
 * for the pipeline demo.
 */

// ============================================================================
// Types
// ============================================================================

export type PipelineStage =
  | "idle"
  | "ingesting"
  | "normalizing"
  | "grouping"
  | "enriching"
  | "analyzing"
  | "complete"
  | "error";

export type Disposition =
  | "pending"
  | "cleared"
  | "flagged"
  | "human_review"
  | "escalated";

export type Severity = "low" | "medium" | "high" | "critical";

export interface FlagEvent {
  id: string;
  accountId: string;
  merchant: string;
  memo: string;
  amount: number;
  timestamp: string;
  cardLast4: string;
  location: string;
  grouped: boolean;
  redactedMerchant?: string;
  redactedMemo?: string;
  piiFound?: boolean;
}

export interface EnrichmentSignal {
  source: string;
  risk: number;
  detail: string;
}

export interface FraudCase {
  id: string;
  accountId: string;
  events: FlagEvent[];
  signals: EnrichmentSignal[];
  enriched: boolean;
  analyzed: boolean;
  riskScore: number;
  severity: Severity;
  disposition: Disposition;
  dispositionReason?: string;
  analysisNotes?: string;
}

export interface CheckpointEntry {
  id: string;
  label: string;
  createdAt: string;
  stage: PipelineStage;
}

export interface TimelineEntry {
  time: string;
  type: "stage" | "pii" | "budget" | "error" | "checkpoint" | "info";
  message: string;
}

export interface DetectionRule {
  name: string;
  description: string;
  severity: "critical" | "major" | "minor";
}

export interface Scenario {
  name: string;
  description: string;
  rules: DetectionRule[];
  events: FlagEvent[];
}

// ============================================================================
// Mock Enrichment Data
// ============================================================================

const enrichmentDatabase: Record<string, EnrichmentSignal[]> = {
  "acct-1001": [
    { source: "account-history", risk: 30, detail: "3 years, good standing" },
    {
      source: "geo-risk",
      risk: 15,
      detail: "Domestic transactions, consistent location",
    },
    {
      source: "merchant-rep",
      risk: 60,
      detail: "Merchant flagged for card-present fraud",
    },
  ],
  "acct-2002": [
    {
      source: "account-history",
      risk: 70,
      detail: "Recent password change, new device",
    },
    {
      source: "geo-risk",
      risk: 85,
      detail: "Transactions from 3 countries in 24h",
    },
    { source: "merchant-rep", risk: 40, detail: "Mixed merchant reputation" },
  ],
  "acct-3003": [
    {
      source: "account-history",
      risk: 25,
      detail: "5 years, low activity until recently",
    },
    { source: "geo-risk", risk: 20, detail: "Single region" },
    {
      source: "velocity-check",
      risk: 90,
      detail: "Spend velocity 400% above 90-day average",
    },
  ],
  "acct-4004": [
    {
      source: "account-history",
      risk: 45,
      detail: "1 year, moderate activity",
    },
    { source: "geo-risk", risk: 35, detail: "Two regions, consistent pattern" },
    { source: "merchant-rep", risk: 50, detail: "Standard merchants" },
  ],
  "acct-4005": [
    {
      source: "account-history",
      risk: 10,
      detail: "10 years, excellent standing",
    },
    { source: "geo-risk", risk: 10, detail: "Single city" },
    { source: "merchant-rep", risk: 15, detail: "All verified merchants" },
  ],
  "acct-6001": [
    {
      source: "account-history",
      risk: 40,
      detail: "2 years, moderate activity",
    },
    { source: "geo-risk", risk: 20, detail: "Single region, ACH deposits" },
    {
      source: "name-verification",
      risk: 90,
      detail: "Deposit originator names do not match account holder",
    },
  ],
  "acct-6002": [
    {
      source: "account-history",
      risk: 85,
      detail: "Account opened 3 weeks ago, no prior history",
    },
    { source: "geo-risk", risk: 30, detail: "Single city, domestic" },
    {
      source: "velocity-check",
      risk: 95,
      detail: "Deposit-withdrawal velocity 800% above baseline",
    },
  ],
  "acct-6003": [
    {
      source: "account-history",
      risk: 55,
      detail: "1 year, low activity until recently",
    },
    {
      source: "merchant-rep",
      risk: 70,
      detail: "Refund volume exceeds purchase history",
    },
    {
      source: "chargeback-history",
      risk: 80,
      detail: "Multiple merchant-initiated credits with no matching debits",
    },
  ],
  "acct-6004": [
    {
      source: "account-history",
      risk: 75,
      detail: "6 months, minimal legitimate activity",
    },
    {
      source: "geo-risk",
      risk: 90,
      detail: "All outgoing wires to high-risk international destinations",
    },
    {
      source: "velocity-check",
      risk: 85,
      detail: "Average dwell time under 2 hours for all funds",
    },
  ],
};

export function getMockEnrichment(accountId: string): EnrichmentSignal[] {
  return (
    enrichmentDatabase[accountId] ?? [
      {
        source: "account-history",
        risk: 50,
        detail: "No enrichment data available",
      },
    ]
  );
}

// ============================================================================
// Scenarios
// ============================================================================

export const scenarios: Record<string, Scenario> = {
  "card-skimming": {
    name: "Card Skimming",
    description:
      "A gas station processes 8 different credit cards in under an hour. Each transaction is a small fuel purchase, but every card number is different — the signature pattern of a skimming device installed on a payment terminal.",
    rules: [
      {
        name: "Same-Merchant Clustering",
        description:
          "Multiple cards used at the same merchant in a short window",
        severity: "critical",
      },
      {
        name: "Multi-Card Velocity",
        description: "High number of distinct cards at a single terminal",
        severity: "major",
      },
      {
        name: "Small-Amount Probing",
        description: "Repeated small charges consistent with card testing",
        severity: "minor",
      },
    ],
    events: [
      {
        id: "cs-001",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel purchase",
        amount: 75.0,
        timestamp: "2026-02-24T10:05:00Z",
        cardLast4: "4421",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-002",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel + snacks",
        amount: 42.5,
        timestamp: "2026-02-24T10:12:00Z",
        cardLast4: "8832",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-003",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel purchase",
        amount: 68.0,
        timestamp: "2026-02-24T10:18:00Z",
        cardLast4: "1190",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-004",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "car wash + fuel",
        amount: 95.0,
        timestamp: "2026-02-24T10:25:00Z",
        cardLast4: "5567",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-005",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel",
        amount: 55.0,
        timestamp: "2026-02-24T10:31:00Z",
        cardLast4: "3344",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-006",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel purchase",
        amount: 82.0,
        timestamp: "2026-02-24T10:38:00Z",
        cardLast4: "9901",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-007",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel + drinks",
        amount: 38.5,
        timestamp: "2026-02-24T10:44:00Z",
        cardLast4: "2278",
        location: "Houston, TX",
        grouped: false,
      },
      {
        id: "cs-008",
        accountId: "acct-1001",
        merchant: "QuickGas Station #47",
        memo: "fuel purchase",
        amount: 71.0,
        timestamp: "2026-02-24T10:50:00Z",
        cardLast4: "6655",
        location: "Houston, TX",
        grouped: false,
      },
    ],
  },

  "account-takeover": {
    name: "Account Takeover",
    description:
      "Five high-value purchases appear across four countries in a single day — Berlin, Paris, Tokyo, Dubai, Milan. The account holder's SSN and credit card number appear in transaction memos, suggesting compromised credentials being used for identity verification.",
    rules: [
      {
        name: "Impossible Travel",
        description: "Transactions from multiple countries within hours",
        severity: "critical",
      },
      {
        name: "PII Exposure",
        description: "SSN or credit card numbers found in transaction memos",
        severity: "critical",
      },
      {
        name: "High-Value Burst",
        description: "Multiple large purchases in rapid succession",
        severity: "major",
      },
    ],
    events: [
      {
        id: "at-001",
        accountId: "acct-2002",
        merchant: "ElectroMart Berlin",
        memo: "laptop purchase ref SSN 123-45-6789",
        amount: 2499.99,
        timestamp: "2026-02-24T03:15:00Z",
        cardLast4: "7712",
        location: "Berlin, DE",
        grouped: false,
      },
      {
        id: "at-002",
        accountId: "acct-2002",
        merchant: "LuxWatch Paris",
        memo: "timepiece — card 4532-1234-5678-9012",
        amount: 8750.0,
        timestamp: "2026-02-24T06:30:00Z",
        cardLast4: "7712",
        location: "Paris, FR",
        grouped: false,
      },
      {
        id: "at-003",
        accountId: "acct-2002",
        merchant: "TechHub Tokyo",
        memo: "electronics order",
        amount: 3200.0,
        timestamp: "2026-02-24T14:00:00Z",
        cardLast4: "7712",
        location: "Tokyo, JP",
        grouped: false,
      },
      {
        id: "at-004",
        accountId: "acct-2002",
        merchant: "GoldChain Dubai",
        memo: "jewelry — acct 9876543210",
        amount: 12000.0,
        timestamp: "2026-02-24T18:45:00Z",
        cardLast4: "7712",
        location: "Dubai, AE",
        grouped: false,
      },
      {
        id: "at-005",
        accountId: "acct-2002",
        merchant: "DesignerBags Milan",
        memo: "luxury goods purchase",
        amount: 5600.0,
        timestamp: "2026-02-24T22:10:00Z",
        cardLast4: "7712",
        location: "Milan, IT",
        grouped: false,
      },
    ],
  },

  "bust-out": {
    name: "Bust-Out Fraud",
    description:
      "Over 12 days, spending escalates from a $15 deli lunch to a $15,000 wire transfer. Each purchase is slightly larger than the last — a classic bust-out where a fraudster builds trust with small transactions before draining the account.",
    rules: [
      {
        name: "Amount Escalation",
        description: "Transaction amounts increase steadily over time",
        severity: "critical",
      },
      {
        name: "Category Escalation",
        description: "Purchases shift from low-risk to high-risk categories",
        severity: "major",
      },
      {
        name: "Velocity Increase",
        description: "Transaction frequency accelerates toward the end",
        severity: "minor",
      },
    ],
    events: [
      {
        id: "bo-001",
        accountId: "acct-3003",
        merchant: "Corner Deli",
        memo: "lunch",
        amount: 15.0,
        timestamp: "2026-02-10T12:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-002",
        accountId: "acct-3003",
        merchant: "Gas N Go",
        memo: "fuel",
        amount: 45.0,
        timestamp: "2026-02-12T08:30:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-003",
        accountId: "acct-3003",
        merchant: "MegaMart",
        memo: "groceries",
        amount: 120.0,
        timestamp: "2026-02-14T17:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-004",
        accountId: "acct-3003",
        merchant: "BestBuy Electronics",
        memo: "TV purchase",
        amount: 899.99,
        timestamp: "2026-02-16T11:15:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-005",
        accountId: "acct-3003",
        merchant: "AppleStore",
        memo: "MacBook Pro",
        amount: 2499.0,
        timestamp: "2026-02-17T14:30:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-006",
        accountId: "acct-3003",
        merchant: "Jewelry Palace",
        memo: "gold necklace",
        amount: 3500.0,
        timestamp: "2026-02-18T10:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-007",
        accountId: "acct-3003",
        merchant: "LuxAuto Dealer",
        memo: "vehicle deposit",
        amount: 5000.0,
        timestamp: "2026-02-19T09:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-008",
        accountId: "acct-3003",
        merchant: "CashAdvance ATM",
        memo: "cash withdrawal",
        amount: 2000.0,
        timestamp: "2026-02-19T15:30:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-009",
        accountId: "acct-3003",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire",
        amount: 8000.0,
        timestamp: "2026-02-20T08:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-010",
        accountId: "acct-3003",
        merchant: "CryptoExchange",
        memo: "BTC purchase",
        amount: 10000.0,
        timestamp: "2026-02-20T12:45:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-011",
        accountId: "acct-3003",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire #2",
        amount: 15000.0,
        timestamp: "2026-02-21T07:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "bo-012",
        accountId: "acct-3003",
        merchant: "CashAdvance ATM",
        memo: "max withdrawal",
        amount: 5000.0,
        timestamp: "2026-02-21T16:00:00Z",
        cardLast4: "3301",
        location: "Chicago, IL",
        grouped: false,
      },
    ],
  },

  "mixed-batch": {
    name: "Mixed Batch",
    description:
      "Three accounts with very different risk profiles: one with routine grocery and Netflix charges, one with luxury jewelry purchases, and one making offshore wire transfers. Shows how the system handles mixed legitimate and suspicious activity in a single batch.",
    rules: [
      {
        name: "Cross-Account Risk Variance",
        description:
          "Wide spread in risk scores across accounts in the same batch",
        severity: "major",
      },
      {
        name: "High-Value Outliers",
        description: "Individual transactions far exceeding account baseline",
        severity: "major",
      },
      {
        name: "Legitimate Baseline",
        description: "Normal spending patterns providing comparison context",
        severity: "minor",
      },
    ],
    events: [
      {
        id: "mb-001",
        accountId: "acct-4004",
        merchant: "Online Bookstore",
        memo: "textbooks",
        amount: 89.99,
        timestamp: "2026-02-24T09:00:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-002",
        accountId: "acct-4004",
        merchant: "Online Bookstore",
        memo: "novels",
        amount: 34.5,
        timestamp: "2026-02-24T09:05:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-003",
        accountId: "acct-4004",
        merchant: "ShadyElectronics",
        memo: "bulk phones — SSN 987-65-4321",
        amount: 4500.0,
        timestamp: "2026-02-24T10:00:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-004",
        accountId: "acct-4004",
        merchant: "ShadyElectronics",
        memo: "accessories",
        amount: 350.0,
        timestamp: "2026-02-24T10:15:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-005",
        accountId: "acct-4004",
        merchant: "CoffeeCo",
        memo: "morning coffee",
        amount: 5.75,
        timestamp: "2026-02-24T07:30:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-006",
        accountId: "acct-2002",
        merchant: "HighEnd Jewelers",
        memo: "diamond ring",
        amount: 15000.0,
        timestamp: "2026-02-24T11:00:00Z",
        cardLast4: "7712",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "mb-007",
        accountId: "acct-2002",
        merchant: "HighEnd Jewelers",
        memo: "matching earrings",
        amount: 8500.0,
        timestamp: "2026-02-24T11:20:00Z",
        cardLast4: "7712",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "mb-008",
        accountId: "acct-5005",
        merchant: "Grocery Mart",
        memo: "weekly groceries",
        amount: 67.3,
        timestamp: "2026-02-24T16:00:00Z",
        cardLast4: "5501",
        location: "Denver, CO",
        grouped: false,
      },
      {
        id: "mb-009",
        accountId: "acct-5005",
        merchant: "Gas Station",
        memo: "fuel",
        amount: 52.0,
        timestamp: "2026-02-24T16:30:00Z",
        cardLast4: "5501",
        location: "Denver, CO",
        grouped: false,
      },
      {
        id: "mb-010",
        accountId: "acct-4004",
        merchant: "FastCash ATM",
        memo: "cash withdrawal — ref 4111-2222-3333-4444",
        amount: 1000.0,
        timestamp: "2026-02-24T12:00:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-011",
        accountId: "acct-4004",
        merchant: "FastCash ATM",
        memo: "second withdrawal",
        amount: 1000.0,
        timestamp: "2026-02-24T12:30:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
      {
        id: "mb-012",
        accountId: "acct-5005",
        merchant: "Netflix",
        memo: "monthly subscription",
        amount: 15.99,
        timestamp: "2026-02-24T00:00:00Z",
        cardLast4: "5501",
        location: "Denver, CO",
        grouped: false,
      },
      {
        id: "mb-013",
        accountId: "acct-5005",
        merchant: "Spotify",
        memo: "music subscription",
        amount: 10.99,
        timestamp: "2026-02-24T00:00:00Z",
        cardLast4: "5501",
        location: "Denver, CO",
        grouped: false,
      },
      {
        id: "mb-014",
        accountId: "acct-2002",
        merchant: "Offshore Trading Co",
        memo: "investment wire",
        amount: 25000.0,
        timestamp: "2026-02-24T14:00:00Z",
        cardLast4: "7712",
        location: "Cayman Islands",
        grouped: false,
      },
      {
        id: "mb-015",
        accountId: "acct-4004",
        merchant: "CoffeeCo",
        memo: "afternoon coffee",
        amount: 6.25,
        timestamp: "2026-02-24T14:30:00Z",
        cardLast4: "4401",
        location: "Austin, TX",
        grouped: false,
      },
    ],
  },

  "deposit-name-mismatch": {
    name: "Deposit Name Mismatch",
    description:
      "Incoming ACH deposits arrive from 'Johnson Industries LLC' and 'M. Rodriguez DBA QuickCash', but the account belongs to 'Sarah Chen'. None of the deposit originator names match the account holder — a red flag for money mule activity or payroll fraud.",
    rules: [
      {
        name: "Name Mismatch",
        description: "Deposit originator names do not match account holder",
        severity: "critical",
      },
      {
        name: "Multiple Originators",
        description: "Deposits from several unrelated entities to one account",
        severity: "major",
      },
      {
        name: "Structuring Pattern",
        description:
          "Amounts cluster just below the $10,000 reporting threshold",
        severity: "minor",
      },
    ],
    events: [
      {
        id: "dnm-001",
        accountId: "acct-6001",
        merchant: "ACH Deposit — Johnson Industries LLC",
        memo: "payroll deposit",
        amount: 4800.0,
        timestamp: "2026-02-20T08:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-002",
        accountId: "acct-6001",
        merchant: "ACH Deposit — M. Rodriguez DBA QuickCash",
        memo: "vendor payment",
        amount: 9500.0,
        timestamp: "2026-02-20T14:30:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-003",
        accountId: "acct-6001",
        merchant: "ACH Deposit — Johnson Industries LLC",
        memo: "bonus payment",
        amount: 3200.0,
        timestamp: "2026-02-21T09:15:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-004",
        accountId: "acct-6001",
        merchant: "ACH Deposit — QuickCash Services",
        memo: "consulting fee",
        amount: 9800.0,
        timestamp: "2026-02-21T16:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-005",
        accountId: "acct-6001",
        merchant: "ACH Deposit — R. Patel Enterprises",
        memo: "invoice payment",
        amount: 7500.0,
        timestamp: "2026-02-22T10:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-006",
        accountId: "acct-6001",
        merchant: "ACH Deposit — Johnson Industries LLC",
        memo: "reimbursement",
        amount: 2100.0,
        timestamp: "2026-02-22T15:45:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-007",
        accountId: "acct-6001",
        merchant: "ACH Deposit — M. Rodriguez DBA QuickCash",
        memo: "service payment",
        amount: 9400.0,
        timestamp: "2026-02-23T08:30:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "dnm-008",
        accountId: "acct-6001",
        merchant: "ACH Deposit — Unknown Originator",
        memo: "transfer",
        amount: 500.0,
        timestamp: "2026-02-23T17:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
    ],
  },

  "cash-in-cash-out": {
    name: "Cash In / Cash Out",
    description:
      "A new account receives three large cash deposits totaling $28,000 over two days. Within hours of each deposit, nearly the same amount is withdrawn via ATM or wire — leaving the account near zero each time. The rapid deposit-withdrawal cycle is a hallmark of money laundering.",
    rules: [
      {
        name: "High-Velocity Cash Movement",
        description: "Large cash deposits immediately followed by withdrawals",
        severity: "critical",
      },
      {
        name: "Deposit-Withdrawal Symmetry",
        description: "Withdrawal amounts closely match preceding deposits",
        severity: "critical",
      },
      {
        name: "New Account Risk",
        description:
          "Account opened within the last 30 days with unusual activity",
        severity: "major",
      },
    ],
    events: [
      {
        id: "cico-001",
        accountId: "acct-6002",
        merchant: "Branch Deposit",
        memo: "cash deposit",
        amount: 9500.0,
        timestamp: "2026-02-22T09:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-002",
        accountId: "acct-6002",
        merchant: "Chase ATM #401",
        memo: "cash withdrawal",
        amount: 5000.0,
        timestamp: "2026-02-22T11:30:00Z",
        cardLast4: "6201",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-003",
        accountId: "acct-6002",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire",
        amount: 4200.0,
        timestamp: "2026-02-22T13:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-004",
        accountId: "acct-6002",
        merchant: "Branch Deposit",
        memo: "cash deposit",
        amount: 8500.0,
        timestamp: "2026-02-22T15:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-005",
        accountId: "acct-6002",
        merchant: "Wells Fargo ATM",
        memo: "cash withdrawal",
        amount: 5000.0,
        timestamp: "2026-02-22T17:15:00Z",
        cardLast4: "6201",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-006",
        accountId: "acct-6002",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire",
        amount: 3300.0,
        timestamp: "2026-02-22T18:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-007",
        accountId: "acct-6002",
        merchant: "Branch Deposit",
        memo: "cash deposit",
        amount: 10000.0,
        timestamp: "2026-02-23T09:30:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-008",
        accountId: "acct-6002",
        merchant: "Chase ATM #401",
        memo: "max withdrawal",
        amount: 5000.0,
        timestamp: "2026-02-23T11:00:00Z",
        cardLast4: "6201",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-009",
        accountId: "acct-6002",
        merchant: "BOA ATM #220",
        memo: "cash withdrawal",
        amount: 3000.0,
        timestamp: "2026-02-23T12:30:00Z",
        cardLast4: "6201",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-010",
        accountId: "acct-6002",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — final",
        amount: 1800.0,
        timestamp: "2026-02-23T14:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-011",
        accountId: "acct-6002",
        merchant: "Citibank ATM",
        memo: "balance inquiry + withdraw",
        amount: 200.0,
        timestamp: "2026-02-23T16:00:00Z",
        cardLast4: "6201",
        location: "Chicago, IL",
        grouped: false,
      },
      {
        id: "cico-012",
        accountId: "acct-6002",
        merchant: "Branch Deposit",
        memo: "cash deposit",
        amount: 6000.0,
        timestamp: "2026-02-24T08:00:00Z",
        cardLast4: "0000",
        location: "Chicago, IL",
        grouped: false,
      },
    ],
  },

  "merchant-credit-abuse": {
    name: "Merchant Credit Abuse",
    description:
      "An account receives $47,000 in merchant refund credits from six different retailers over two weeks, but there are zero corresponding purchase debits. Credits without purchases suggest return fraud at scale, collusion with merchants, or compromised merchant terminals.",
    rules: [
      {
        name: "Credits Without Debits",
        description: "Refund credits with no matching purchase transactions",
        severity: "critical",
      },
      {
        name: "Multi-Merchant Refunds",
        description: "Refunds from multiple unrelated merchants to one account",
        severity: "major",
      },
      {
        name: "Refund Velocity",
        description: "High frequency of refund credits in a short period",
        severity: "major",
      },
    ],
    events: [
      {
        id: "mca-001",
        accountId: "acct-6003",
        merchant: "BestBuy — Refund",
        memo: "return credit — electronics",
        amount: 8500.0,
        timestamp: "2026-02-12T10:00:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-002",
        accountId: "acct-6003",
        merchant: "Target — Refund",
        memo: "return credit — home goods",
        amount: 3200.0,
        timestamp: "2026-02-13T14:30:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-003",
        accountId: "acct-6003",
        merchant: "Nordstrom — Refund",
        memo: "return credit — clothing",
        amount: 12000.0,
        timestamp: "2026-02-15T09:00:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-004",
        accountId: "acct-6003",
        merchant: "Apple Store — Refund",
        memo: "return credit — MacBook",
        amount: 2499.0,
        timestamp: "2026-02-16T11:15:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-005",
        accountId: "acct-6003",
        merchant: "Costco — Refund",
        memo: "return credit — bulk order",
        amount: 5600.0,
        timestamp: "2026-02-18T13:00:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-006",
        accountId: "acct-6003",
        merchant: "HomeDepot — Refund",
        memo: "return credit — tools",
        amount: 4200.0,
        timestamp: "2026-02-19T10:30:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-007",
        accountId: "acct-6003",
        merchant: "BestBuy — Refund",
        memo: "return credit — TV",
        amount: 3500.0,
        timestamp: "2026-02-21T15:00:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-008",
        accountId: "acct-6003",
        merchant: "Samsung Direct — Refund",
        memo: "return credit — phone",
        amount: 1299.0,
        timestamp: "2026-02-22T09:45:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-009",
        accountId: "acct-6003",
        merchant: "Target — Refund",
        memo: "return credit — appliances",
        amount: 4800.0,
        timestamp: "2026-02-23T16:00:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
      {
        id: "mca-010",
        accountId: "acct-6003",
        merchant: "Walmart — Refund",
        memo: "return credit — electronics",
        amount: 1400.0,
        timestamp: "2026-02-24T08:30:00Z",
        cardLast4: "6301",
        location: "Dallas, TX",
        grouped: false,
      },
    ],
  },

  "rapid-funds-movement": {
    name: "Rapid Funds Movement",
    description:
      "Money arrives via ACH, sits for under 2 hours, then leaves via wire transfer to an overseas account. This pattern repeats 5 times in a single week, each time with a different originator. The account is being used as a pass-through — funds never stay long enough for legitimate use.",
    rules: [
      {
        name: "Pass-Through Pattern",
        description: "Funds received and forwarded with minimal dwell time",
        severity: "critical",
      },
      {
        name: "Short Dwell Time",
        description:
          "Funds remain in account for less than 2 hours before transfer",
        severity: "critical",
      },
      {
        name: "Multi-Originator",
        description: "Incoming funds from multiple unrelated sources",
        severity: "major",
      },
      {
        name: "International Wire Destination",
        description: "Outgoing wires routed to overseas accounts",
        severity: "major",
      },
    ],
    events: [
      {
        id: "rfm-001",
        accountId: "acct-6004",
        merchant: "ACH Deposit — Apex Trading LLC",
        memo: "business payment",
        amount: 15000.0,
        timestamp: "2026-02-18T08:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "rfm-002",
        accountId: "acct-6004",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — Hong Kong",
        amount: 14800.0,
        timestamp: "2026-02-18T09:30:00Z",
        cardLast4: "0000",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "rfm-003",
        accountId: "acct-6004",
        merchant: "ACH Deposit — GlobalTech Solutions",
        memo: "consulting fee",
        amount: 22000.0,
        timestamp: "2026-02-19T10:15:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "rfm-004",
        accountId: "acct-6004",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — Singapore",
        amount: 21500.0,
        timestamp: "2026-02-19T11:45:00Z",
        cardLast4: "0000",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "rfm-005",
        accountId: "acct-6004",
        merchant: "ACH Deposit — Meridian Corp",
        memo: "invoice settlement",
        amount: 18500.0,
        timestamp: "2026-02-20T09:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "rfm-006",
        accountId: "acct-6004",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — Dubai",
        amount: 18200.0,
        timestamp: "2026-02-20T10:30:00Z",
        cardLast4: "0000",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "rfm-007",
        accountId: "acct-6004",
        merchant: "ACH Deposit — Pacific Rim Holdings",
        memo: "distribution payment",
        amount: 31000.0,
        timestamp: "2026-02-22T08:30:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "rfm-008",
        accountId: "acct-6004",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — Cayman Islands",
        amount: 30500.0,
        timestamp: "2026-02-22T10:00:00Z",
        cardLast4: "0000",
        location: "New York, NY",
        grouped: false,
      },
      {
        id: "rfm-009",
        accountId: "acct-6004",
        merchant: "ACH Deposit — Sterling Ventures",
        memo: "investment return",
        amount: 25000.0,
        timestamp: "2026-02-24T09:00:00Z",
        cardLast4: "0000",
        location: "ACH Network",
        grouped: false,
      },
      {
        id: "rfm-010",
        accountId: "acct-6004",
        merchant: "WireTransfer Intl",
        memo: "outgoing wire — Switzerland",
        amount: 24700.0,
        timestamp: "2026-02-24T10:15:00Z",
        cardLast4: "0000",
        location: "New York, NY",
        grouped: false,
      },
    ],
  },
};

// ============================================================================
// Seeded PRNG (Mulberry32) — deterministic, zero deps
// ============================================================================

function createRng(seed: number): () => number {
  let s = seed | 0;

  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rngPick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function rngFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

// ============================================================================
// Data Pools
// ============================================================================

const MERCHANTS: Record<string, readonly string[]> = {
  retail: [
    "Target",
    "Walmart",
    "Costco",
    "HomeDepot",
    "Nordstrom",
    "TJ Maxx",
    "Macy's",
    "Kohl's",
  ],
  gas: [
    "Shell Station #12",
    "BP Gas",
    "Chevron #88",
    "QuickStop Fuel",
    "Valero #5",
    "Mobil Express",
  ],
  food: ["Whole Foods", "Trader Joe's", "Kroger", "Safeway", "Publix", "Aldi"],
  restaurant: [
    "Olive Garden",
    "Chipotle",
    "McDonald's",
    "Starbucks",
    "Panera Bread",
    "Chili's",
  ],
  electronics: [
    "Best Buy",
    "Micro Center",
    "B&H Photo",
    "Newegg Online",
    "Apple Store",
    "Samsung Direct",
  ],
  luxury: [
    "Tiffany & Co",
    "Louis Vuitton",
    "Gucci Boutique",
    "Cartier",
    "Rolex Boutique",
    "Hermès",
  ],
  online: [
    "Amazon.com",
    "eBay Inc",
    "Shopify Store",
    "Etsy Purchase",
    "Wish.com",
    "AliExpress",
  ],
  travel: [
    "Delta Airlines",
    "Marriott Hotels",
    "Expedia Booking",
    "Uber Rides",
    "Hertz Rental",
    "Airbnb",
  ],
  atm: [
    "Chase ATM #401",
    "Wells Fargo ATM",
    "BOA ATM #220",
    "Citibank ATM",
    "PNC ATM",
    "TD Bank ATM",
  ],
  wire: [
    "WireTransfer Intl",
    "Western Union",
    "MoneyGram",
    "Remitly Transfer",
    "TransferWise",
    "Zelle Business",
  ],
  crypto: [
    "Coinbase Exchange",
    "Binance US",
    "Kraken Trade",
    "Gemini Exchange",
    "Bitcoin ATM",
    "Crypto.com",
  ],
  gambling: [
    "DraftKings",
    "FanDuel",
    "BetMGM",
    "PokerStars",
    "Bovada Online",
    "Casino Royale",
  ],
  subscription: [
    "Netflix",
    "Spotify",
    "Adobe Creative",
    "Microsoft 365",
    "Hulu",
    "Disney+",
  ],
  suspicious: [
    "Fast Cash LLC",
    "Offshore Trading Co",
    "UnknownMerchant",
    "CashAdvance Express",
    "Foreign Wire Co",
    "AnonymousPay",
  ],
};

const LOCATIONS: Record<string, readonly string[]> = {
  us_east: [
    "New York, NY",
    "Boston, MA",
    "Miami, FL",
    "Atlanta, GA",
    "Philadelphia, PA",
    "Washington, DC",
  ],
  us_central: [
    "Chicago, IL",
    "Dallas, TX",
    "Houston, TX",
    "Nashville, TN",
    "Minneapolis, MN",
    "St. Louis, MO",
  ],
  us_west: [
    "Los Angeles, CA",
    "San Francisco, CA",
    "Seattle, WA",
    "Portland, OR",
    "Denver, CO",
    "Phoenix, AZ",
  ],
  europe: [
    "London, UK",
    "Paris, FR",
    "Berlin, DE",
    "Amsterdam, NL",
    "Zurich, CH",
    "Rome, IT",
  ],
  asia: [
    "Tokyo, JP",
    "Singapore, SG",
    "Hong Kong, HK",
    "Seoul, KR",
    "Taipei, TW",
    "Shanghai, CN",
  ],
  high_risk: [
    "Lagos, NG",
    "Kyiv, UA",
    "Minsk, BY",
    "Caracas, VE",
    "Dhaka, BD",
    "Phnom Penh, KH",
  ],
};

const CLEAN_MEMOS: Record<string, readonly string[]> = {
  retail: [
    "in-store purchase",
    "online order",
    "returns exchange",
    "store pickup",
    "clearance sale",
  ],
  gas: [
    "fuel purchase",
    "fuel + snacks",
    "premium unleaded",
    "diesel fill-up",
    "car wash + fuel",
  ],
  food: [
    "weekly groceries",
    "produce + dairy",
    "bulk purchase",
    "organic items",
    "pantry restock",
  ],
  restaurant: [
    "dinner for two",
    "lunch order",
    "takeout",
    "catering order",
    "breakfast",
  ],
  electronics: [
    "laptop purchase",
    "phone accessories",
    "TV purchase",
    "headphones",
    "tablet order",
  ],
  luxury: [
    "jewelry purchase",
    "designer handbag",
    "timepiece",
    "accessories",
    "gift purchase",
  ],
  online: [
    "marketplace order",
    "digital download",
    "subscription box",
    "flash sale",
    "prime purchase",
  ],
  travel: [
    "flight booking",
    "hotel reservation",
    "car rental",
    "ride fare",
    "vacation package",
  ],
  atm: [
    "cash withdrawal",
    "balance inquiry + withdraw",
    "max withdrawal",
    "emergency cash",
  ],
  wire: [
    "outgoing wire",
    "international transfer",
    "domestic wire",
    "recurring transfer",
    "business payment",
  ],
  crypto: [
    "BTC purchase",
    "ETH trade",
    "crypto deposit",
    "exchange transfer",
    "wallet top-up",
  ],
  gambling: [
    "sports bet",
    "casino deposit",
    "tournament entry",
    "parlay wager",
    "daily fantasy",
  ],
  subscription: [
    "monthly subscription",
    "annual renewal",
    "plan upgrade",
    "auto-renewal",
    "premium tier",
  ],
  suspicious: [
    "urgent transfer",
    "business expense",
    "consulting fee",
    "investment deposit",
    "service charge",
  ],
};

const PII_TEMPLATES = [
  "ref SSN {{ssn}}",
  "memo: SSN {{ssn}} on file",
  "card {{cc}} — authorized",
  "acct {{bank}} transfer",
  "verify SSN {{ssn}} for auth",
  "backup card {{cc}}",
  "routing to {{bank}}",
  "SSN {{ssn}} bank {{bank}}",
] as const;

// ============================================================================
// PII Generators
// ============================================================================

function generateSsn(rng: () => number): string {
  return `${rngInt(rng, 100, 999)}-${rngInt(rng, 10, 99)}-${rngInt(rng, 1000, 9999)}`;
}

function generateCc(rng: () => number): string {
  const g = () => rngInt(rng, 1000, 9999);

  return `${g()}-${g()}-${g()}-${g()}`;
}

function generateBankAcct(rng: () => number): string {
  let acct = "";
  for (let i = 0; i < 10; i++) {
    acct += rngInt(rng, 0, 9);
  }

  return acct;
}

function injectPii(
  rng: () => number,
  baseMemo: string,
  piiTypes: readonly ("ssn" | "cc" | "bank")[],
): string {
  const available = PII_TEMPLATES.filter((t) => {
    if (t.includes("{{ssn}}") && !piiTypes.includes("ssn")) {
      return false;
    }
    if (t.includes("{{cc}}") && !piiTypes.includes("cc")) {
      return false;
    }
    if (t.includes("{{bank}}") && !piiTypes.includes("bank")) {
      return false;
    }

    return true;
  });

  if (available.length === 0) {
    return baseMemo;
  }

  let result = `${baseMemo} — ${rngPick(rng, available)}`;
  result = result.replace(/\{\{ssn\}\}/g, generateSsn(rng));
  result = result.replace(/\{\{cc\}\}/g, generateCc(rng));
  result = result.replace(/\{\{bank\}\}/g, generateBankAcct(rng));

  return result;
}

// ============================================================================
// Enrichment Generator
// ============================================================================

const ENRICHMENT_SIGNAL_POOL = [
  {
    source: "device-fingerprint",
    details: {
      low: "Known device, consistent browser fingerprint",
      medium: "New device, IP matches known range",
      high: "Unrecognized device, VPN detected",
      critical: "TOR exit node, device spoofing indicators",
    },
  },
  {
    source: "behavioral-analytics",
    details: {
      low: "Normal spending pattern, consistent timing",
      medium: "Slight deviation from 90-day baseline",
      high: "Significant behavioral anomaly detected",
      critical: "Complete pattern break, automated behavior suspected",
    },
  },
  {
    source: "network-graph",
    details: {
      low: "No suspicious connections found",
      medium: "Shared device with 1 other account",
      high: "Connected to 3+ flagged accounts",
      critical: "Central node in known fraud ring",
    },
  },
  {
    source: "dark-web-monitoring",
    details: {
      low: "No credentials found on dark web",
      medium: "Email found in 1 breach database",
      high: "Card details found on paste site",
      critical: "Full identity package listed for sale",
    },
  },
  {
    source: "address-verification",
    details: {
      low: "Address verified, matches billing records",
      medium: "Address valid, minor discrepancy in unit number",
      high: "Address doesn't match billing records",
      critical: "Address linked to known fraud drop location",
    },
  },
  {
    source: "ip-reputation",
    details: {
      low: "Residential IP, good reputation score",
      medium: "Commercial IP, no prior flags",
      high: "Data center IP, proxy service detected",
      critical: "Blacklisted IP, known attack source",
    },
  },
  {
    source: "chargeback-history",
    details: {
      low: "Zero chargebacks in 12 months",
      medium: "1 chargeback in 12 months, resolved",
      high: "3+ chargebacks in 6 months",
      critical: "Serial chargeback pattern, merchant disputes active",
    },
  },
] as const;

const RISK_BIAS: Record<string, [number, number]> = {
  low: [5, 35],
  medium: [25, 55],
  high: [50, 80],
  critical: [70, 98],
};

function generateEnrichment(
  rng: () => number,
  riskProfile: "low" | "medium" | "high" | "critical",
): EnrichmentSignal[] {
  const count = rngInt(rng, 3, 5);
  const shuffled = [...ENRICHMENT_SIGNAL_POOL].sort(() => rng() - 0.5);
  const selected = shuffled.slice(0, count);
  const [minRisk, maxRisk] = RISK_BIAS[riskProfile];

  return selected.map((signal) => ({
    source: signal.source,
    risk: rngInt(rng, minRisk, maxRisk),
    detail: signal.details[riskProfile],
  }));
}

// ============================================================================
// Scenario Generator
// ============================================================================

interface ScenarioConfig {
  key: string;
  name: string;
  description: string;
  rules: DetectionRule[];
  seed: number;
  eventCount: number;
  accountCount: number;
  merchantCategories: string[];
  locationProfile:
    | "single_city"
    | "single_region"
    | "multi_region"
    | "global"
    | "high_risk_global";
  amountRange: { min: number; max: number };
  amountDistribution:
    | "uniform"
    | "escalating"
    | "bimodal"
    | "small_with_spikes";
  piiDensity: number;
  piiTypes: ("ssn" | "cc" | "bank")[];
  timeSpanHours: number;
  timePattern: "clustered" | "spread" | "burst";
  cardPattern: "same_card" | "few_cards" | "many_cards";
  riskProfile: "low" | "medium" | "high" | "critical";
}

function buildLocationPool(
  rng: () => number,
  profile: ScenarioConfig["locationProfile"],
): string[] {
  const usRegions = ["us_east", "us_central", "us_west"] as const;

  switch (profile) {
    case "single_city": {
      const region = rngPick(rng, usRegions);
      const city = rngPick(rng, LOCATIONS[region]);

      return [city];
    }

    case "single_region": {
      const region = rngPick(rng, usRegions);

      return [...LOCATIONS[region]];
    }

    case "multi_region": {
      const regions = [...usRegions, "europe" as const].sort(() => rng() - 0.5);
      const count = rngInt(rng, 2, 3);

      return regions.slice(0, count).flatMap((r) => [...LOCATIONS[r]]);
    }

    case "global":
      return Object.keys(LOCATIONS).flatMap((k) => [...LOCATIONS[k]]);

    case "high_risk_global": {
      const all = Object.keys(LOCATIONS).flatMap((k) => [...LOCATIONS[k]]);

      return [...all, ...LOCATIONS.high_risk, ...LOCATIONS.high_risk];
    }
  }
}

function generateAmount(
  rng: () => number,
  range: { min: number; max: number },
  distribution: ScenarioConfig["amountDistribution"],
  index: number,
  total: number,
): number {
  switch (distribution) {
    case "uniform":
      return rngFloat(rng, range.min, range.max);

    case "escalating": {
      const progress = index / Math.max(total - 1, 1);
      const base = range.min + progress * (range.max - range.min);
      const jitter = (range.max - range.min) * 0.1;

      return Math.max(range.min, base + rngFloat(rng, -jitter, jitter));
    }

    case "bimodal": {
      const lowEnd = range.min + (range.max - range.min) * 0.2;
      const highStart = range.min + (range.max - range.min) * 0.7;

      if (rng() < 0.5) {
        return rngFloat(rng, range.min, lowEnd);
      }

      return rngFloat(rng, highStart, range.max);
    }

    case "small_with_spikes": {
      const smallMax = range.min + (range.max - range.min) * 0.1;

      if (rng() < 0.8) {
        return rngFloat(rng, range.min, smallMax);
      }

      return rngFloat(rng, smallMax, range.max);
    }
  }
}

function generateTimestamp(
  rng: () => number,
  baseTime: number,
  spanHours: number,
  pattern: ScenarioConfig["timePattern"],
  index: number,
  total: number,
): string {
  const spanMs = spanHours * 60 * 60 * 1000;

  switch (pattern) {
    case "spread": {
      const slot = (index / total) * spanMs;
      const jitter = (spanMs / total) * 0.3;
      const time = baseTime + slot + rngFloat(rng, -jitter, jitter);

      return new Date(Math.max(baseTime, time)).toISOString();
    }

    case "clustered": {
      const clusterSize = 5;
      const clusterIndex = Math.floor(index / clusterSize);
      const withinCluster = index % clusterSize;
      const clusterCount = Math.ceil(total / clusterSize);
      const clusterStart = (clusterIndex / clusterCount) * spanMs;
      const clusterSpan = spanMs * 0.05;
      const time =
        baseTime +
        clusterStart +
        (withinCluster / clusterSize) * clusterSpan +
        rngFloat(rng, 0, clusterSpan * 0.2);

      return new Date(time).toISOString();
    }

    case "burst": {
      const burstSize = 10;
      const burstIndex = Math.floor(index / burstSize);
      const withinBurst = index % burstSize;
      const burstCount = Math.ceil(total / burstSize);
      const burstStart = (burstIndex / burstCount) * spanMs;
      const burstSpan = 5 * 60 * 1000;
      const time =
        baseTime +
        burstStart +
        (withinBurst / burstSize) * burstSpan +
        rngFloat(rng, 0, 30000);

      return new Date(time).toISOString();
    }
  }
}

function generateScenario(config: ScenarioConfig): {
  scenario: Scenario;
  enrichments: Record<string, EnrichmentSignal[]>;
} {
  const rng = createRng(config.seed);
  const abbrev = config.key
    .split("-")
    .map((w) => w[0])
    .join("");

  const accountIds = Array.from(
    { length: config.accountCount },
    (_, i) => `acct-${config.seed + i + 1}`,
  );

  const accountCards: Record<string, string[]> = {};
  for (const acctId of accountIds) {
    const cardCount =
      config.cardPattern === "same_card"
        ? 1
        : config.cardPattern === "few_cards"
          ? rngInt(rng, 2, 3)
          : rngInt(rng, 3, 6);
    accountCards[acctId] = Array.from({ length: cardCount }, () =>
      String(rngInt(rng, 1000, 9999)),
    );
  }

  const locationPool = buildLocationPool(rng, config.locationProfile);
  const baseTime = new Date("2026-02-24T00:00:00Z").getTime();

  const events: FlagEvent[] = [];
  for (let i = 0; i < config.eventCount; i++) {
    const acctId = accountIds[i % config.accountCount];
    const category = rngPick(rng, config.merchantCategories);
    const merchants = MERCHANTS[category] ?? MERCHANTS.retail;
    const merchant = rngPick(rng, merchants);
    const location = rngPick(rng, locationPool);
    const amount = generateAmount(
      rng,
      config.amountRange,
      config.amountDistribution,
      i,
      config.eventCount,
    );
    const timestamp = generateTimestamp(
      rng,
      baseTime,
      config.timeSpanHours,
      config.timePattern,
      i,
      config.eventCount,
    );

    const cards = accountCards[acctId];
    const cardLast4 =
      config.cardPattern === "many_cards"
        ? String(rngInt(rng, 1000, 9999))
        : rngPick(rng, cards);

    const memos = CLEAN_MEMOS[category] ?? CLEAN_MEMOS.retail;
    let memo = rngPick(rng, memos);
    if (
      config.piiDensity > 0 &&
      rng() < config.piiDensity &&
      config.piiTypes.length > 0
    ) {
      memo = injectPii(rng, memo, config.piiTypes);
    }

    events.push({
      id: `gen-${abbrev}-${String(i + 1).padStart(3, "0")}`,
      accountId: acctId,
      merchant,
      memo,
      amount: Math.round(amount * 100) / 100,
      timestamp,
      cardLast4,
      location,
      grouped: false,
    });
  }

  events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const enrichments: Record<string, EnrichmentSignal[]> = {};
  for (const acctId of accountIds) {
    enrichments[acctId] = generateEnrichment(rng, config.riskProfile);
  }

  return {
    scenario: {
      name: config.name,
      description: config.description,
      rules: config.rules,
      events,
    },
    enrichments,
  };
}

// ============================================================================
// Generated Scenario Configurations
// ============================================================================

const GENERATED_CONFIGS: ScenarioConfig[] = [
  {
    key: "synthetic-identity",
    name: "Synthetic Identity",
    description:
      "Sixty transactions spread across 12 accounts that were all opened within the same month, shopping at unrelated merchants across multiple regions. The spending patterns are too diverse and too consistent — synthetic identities built from stolen SSNs and fabricated personal details.",
    rules: [
      {
        name: "Coordinated Account Creation",
        description:
          "Multiple accounts opened in the same timeframe with similar patterns",
        severity: "critical",
      },
      {
        name: "Identity Fabrication",
        description:
          "PII combinations that don't match known identity databases",
        severity: "critical",
      },
      {
        name: "Diverse Merchant Spread",
        description:
          "Unusually wide variety of merchant categories for new accounts",
        severity: "major",
      },
    ],
    seed: 6000,
    eventCount: 60,
    accountCount: 12,
    merchantCategories: [
      "retail",
      "electronics",
      "online",
      "subscription",
      "food",
    ],
    locationProfile: "multi_region",
    amountRange: { min: 50, max: 2000 },
    amountDistribution: "uniform",
    piiDensity: 0.15,
    piiTypes: ["ssn", "cc"],
    timeSpanHours: 72,
    timePattern: "spread",
    cardPattern: "many_cards",
    riskProfile: "high",
  },
  {
    key: "friendly-fraud",
    name: "Friendly Fraud",
    description:
      "A customer disputes 35 subscription charges and retail purchases over six accounts, claiming they never authorized any of them. The transactions all used the customer's real card, real device, and real IP address — this is first-party friendly fraud, not unauthorized access.",
    rules: [
      {
        name: "First-Party Dispute Pattern",
        description:
          "Disputes filed on transactions matching the account holder's known devices",
        severity: "critical",
      },
      {
        name: "Multi-Account Dispute",
        description:
          "Same individual disputing charges across multiple accounts",
        severity: "major",
      },
      {
        name: "Subscription Abuse",
        description: "Repeated subscription sign-up and dispute cycles",
        severity: "minor",
      },
    ],
    seed: 7000,
    eventCount: 35,
    accountCount: 6,
    merchantCategories: ["subscription", "retail", "online", "restaurant"],
    locationProfile: "single_region",
    amountRange: { min: 10, max: 500 },
    amountDistribution: "bimodal",
    piiDensity: 0,
    piiTypes: [],
    timeSpanHours: 168,
    timePattern: "spread",
    cardPattern: "few_cards",
    riskProfile: "medium",
  },
  {
    key: "money-laundering",
    name: "Money Laundering",
    description:
      "Eighty transactions moving money through 8 accounts via wire transfers, crypto exchanges, and ATM withdrawals. Amounts escalate from $500 to $50,000, hopping between global cities. The layering pattern is textbook anti-money-laundering (AML) territory.",
    rules: [
      {
        name: "Layering Pattern",
        description:
          "Funds moved through multiple accounts and transaction types to obscure origin",
        severity: "critical",
      },
      {
        name: "Cross-Border Movement",
        description:
          "Transactions spanning multiple countries and jurisdictions",
        severity: "critical",
      },
      {
        name: "Amount Escalation",
        description: "Transaction amounts increase significantly over time",
        severity: "major",
      },
      {
        name: "Crypto Obfuscation",
        description:
          "Cryptocurrency exchanges used as intermediate transfer points",
        severity: "major",
      },
    ],
    seed: 8000,
    eventCount: 80,
    accountCount: 8,
    merchantCategories: ["wire", "crypto", "atm", "suspicious"],
    locationProfile: "global",
    amountRange: { min: 500, max: 50000 },
    amountDistribution: "escalating",
    piiDensity: 0.1,
    piiTypes: ["bank", "ssn"],
    timeSpanHours: 336,
    timePattern: "spread",
    cardPattern: "few_cards",
    riskProfile: "critical",
  },
  {
    key: "credential-stuffing",
    name: "Credential Stuffing",
    description:
      "One hundred small online purchases burst across 20 accounts in a 4-hour window, each using a different credit card. Automated bots are testing stolen card numbers at scale — the purchases are just validation checks before the real fraud begins.",
    rules: [
      {
        name: "Automated Burst Pattern",
        description: "High volume of transactions in a very short time window",
        severity: "critical",
      },
      {
        name: "Card Number Rotation",
        description: "Each transaction uses a different card number",
        severity: "critical",
      },
      {
        name: "Validation Probing",
        description: "Small amounts consistent with card-testing behavior",
        severity: "major",
      },
    ],
    seed: 9000,
    eventCount: 100,
    accountCount: 20,
    merchantCategories: ["online", "electronics", "subscription"],
    locationProfile: "multi_region",
    amountRange: { min: 20, max: 300 },
    amountDistribution: "uniform",
    piiDensity: 0.05,
    piiTypes: ["cc"],
    timeSpanHours: 4,
    timePattern: "burst",
    cardPattern: "many_cards",
    riskProfile: "high",
  },
  {
    key: "return-fraud",
    name: "Return Fraud",
    description:
      "Forty-five purchases at electronics and retail stores, all on the same card, with suspicious amount spikes between routine buys. The pattern suggests purchasing items specifically to return them for cash or store credit at inflated values.",
    rules: [
      {
        name: "Purchase-Return Cycling",
        description:
          "Items purchased and returned repeatedly at the same merchants",
        severity: "critical",
      },
      {
        name: "Amount Spike Pattern",
        description:
          "Large purchases interspersed with small routine transactions",
        severity: "major",
      },
      {
        name: "Single-Card Concentration",
        description: "All activity on one card across multiple merchants",
        severity: "minor",
      },
    ],
    seed: 10000,
    eventCount: 45,
    accountCount: 5,
    merchantCategories: ["retail", "electronics"],
    locationProfile: "single_region",
    amountRange: { min: 15, max: 3000 },
    amountDistribution: "small_with_spikes",
    piiDensity: 0.1,
    piiTypes: ["cc"],
    timeSpanHours: 240,
    timePattern: "spread",
    cardPattern: "same_card",
    riskProfile: "medium",
  },
  {
    key: "first-party-fraud",
    name: "First-Party Fraud",
    description:
      "Fifty transactions across 4 accounts buying luxury goods and making ATM withdrawals, with amounts escalating to $25,000. Forty percent of memos contain PII — SSNs, bank account numbers — suggesting the account holders are intentionally creating a paper trail for a false identity claim.",
    rules: [
      {
        name: "Intentional PII Exposure",
        description: "Unusually high rate of PII in transaction memos (40%+)",
        severity: "critical",
      },
      {
        name: "Luxury Escalation",
        description:
          "Purchases shift from routine items to high-value luxury goods",
        severity: "major",
      },
      {
        name: "ATM Cash Extraction",
        description: "Large ATM withdrawals interspersed with card purchases",
        severity: "major",
      },
      {
        name: "Multi-Account Coordination",
        description:
          "Similar patterns across multiple accounts suggesting coordination",
        severity: "minor",
      },
    ],
    seed: 11000,
    eventCount: 50,
    accountCount: 4,
    merchantCategories: ["luxury", "atm", "wire", "electronics"],
    locationProfile: "single_region",
    amountRange: { min: 100, max: 25000 },
    amountDistribution: "escalating",
    piiDensity: 0.4,
    piiTypes: ["ssn", "cc", "bank"],
    timeSpanHours: 480,
    timePattern: "spread",
    cardPattern: "same_card",
    riskProfile: "critical",
  },
  {
    key: "geo-anomaly",
    name: "Geographic Anomaly",
    description:
      "Forty transactions across 6 accounts showing physically impossible travel — purchases in London, then Tokyo, then S\u00e3o Paulo within hours. The timing and geography don't add up, pointing to cloned cards being used simultaneously across continents.",
    rules: [
      {
        name: "Impossible Travel",
        description:
          "Transactions in distant cities within physically impossible timeframes",
        severity: "critical",
      },
      {
        name: "High-Risk Jurisdiction",
        description: "Transactions originating from flagged geographic regions",
        severity: "major",
      },
      {
        name: "Simultaneous Multi-Location",
        description:
          "Same card used at multiple locations at overlapping times",
        severity: "major",
      },
    ],
    seed: 12000,
    eventCount: 40,
    accountCount: 6,
    merchantCategories: ["travel", "retail", "atm", "luxury"],
    locationProfile: "high_risk_global",
    amountRange: { min: 50, max: 5000 },
    amountDistribution: "uniform",
    piiDensity: 0.05,
    piiTypes: ["cc"],
    timeSpanHours: 48,
    timePattern: "clustered",
    cardPattern: "few_cards",
    riskProfile: "high",
  },
  {
    key: "micro-transaction",
    name: "Micro Transaction Probe",
    description:
      "Seventy tiny transactions ($0.50\u2013$15) spread across 15 accounts. Individually they look harmless — a coffee here, a parking meter there. But the volume and pattern suggest card-testing probes: verify the card works with a micro-charge before escalating.",
    rules: [
      {
        name: "Micro-Amount Pattern",
        description:
          "High volume of very small transactions across many accounts",
        severity: "major",
      },
      {
        name: "Card Testing Indicators",
        description: "Small charges consistent with automated card validation",
        severity: "major",
      },
      {
        name: "Low-Risk Camouflage",
        description:
          "Transaction types designed to blend with legitimate activity",
        severity: "minor",
      },
    ],
    seed: 13000,
    eventCount: 70,
    accountCount: 15,
    merchantCategories: ["gas", "food", "subscription", "restaurant"],
    locationProfile: "single_region",
    amountRange: { min: 0.5, max: 15 },
    amountDistribution: "uniform",
    piiDensity: 0,
    piiTypes: [],
    timeSpanHours: 720,
    timePattern: "spread",
    cardPattern: "few_cards",
    riskProfile: "low",
  },
];

// ============================================================================
// Generate & Merge into scenarios + enrichmentDatabase
// ============================================================================

for (const config of GENERATED_CONFIGS) {
  const { scenario, enrichments } = generateScenario(config);
  scenarios[config.key] = scenario;
  Object.assign(enrichmentDatabase, enrichments);
}
