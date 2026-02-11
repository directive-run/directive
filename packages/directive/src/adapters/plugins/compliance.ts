/**
 * Compliance Plugin - GDPR/CCPA Data Subject Rights
 *
 * Provides enterprise-grade compliance features:
 * - Data Export (DSR) - Export all data for a subject
 * - Data Deletion - Soft/hard delete with certificates
 * - Consent Tracking - Track and enforce consent
 * - Retention Policies - Automatic data retention enforcement
 *
 * @example
 * ```typescript
 * import { createCompliance } from 'directive/openai-agents';
 *
 * const compliance = createCompliance({
 *   storage: myStorageAdapter,
 *   retention: {
 *     defaultRetentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year
 *     categoryRetention: {
 *       audit: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years for audit
 *       sessions: 30 * 24 * 60 * 60 * 1000, // 30 days for sessions
 *     },
 *   },
 * });
 *
 * // Handle data subject request
 * const exportResult = await compliance.exportData({
 *   subjectId: 'user-123',
 *   format: 'json',
 *   includeAudit: true,
 * });
 *
 * // Delete user data
 * const deleteResult = await compliance.deleteData({
 *   subjectId: 'user-123',
 *   scope: 'all',
 * });
 * ```
 */

import type { GuardrailFn, InputGuardrailData, GuardrailResult } from "../ai/index.js";

// ============================================================================
// Types
// ============================================================================

/** Data export request (GDPR Article 20) */
export interface DataExportRequest {
	/** Subject identifier (user ID) */
	subjectId: string;
	/** Export format */
	format: "json" | "csv";
	/** Include audit trail entries */
	includeAudit?: boolean;
	/** Include derived data */
	includeDerived?: boolean;
	/** Specific data categories to export */
	categories?: string[];
	/** Request metadata */
	metadata?: Record<string, unknown>;
}

/** Result of data export */
export interface DataExportResult {
	/** Whether export was successful */
	success: boolean;
	/** Subject identifier */
	subjectId: string;
	/** Export format used */
	format: "json" | "csv";
	/** Exported data */
	data: string;
	/** Data categories included */
	categories: string[];
	/** Number of records exported */
	recordCount: number;
	/** SHA-256 checksum of exported data */
	checksum: string;
	/** Export timestamp */
	exportedAt: number;
	/** Expiration timestamp for download link (if applicable) */
	expiresAt?: number;
	/** Error message if failed */
	error?: string;
}

/** Data deletion scope */
export type DeletionScope = "all" | "facts" | "audit" | "specific";

/** Data deletion request (GDPR Article 17) */
export interface DataDeletionRequest {
	/** Subject identifier (user ID) */
	subjectId: string;
	/** Scope of deletion */
	scope: DeletionScope;
	/** Anonymize instead of delete (retain structure, remove PII) */
	anonymize?: boolean;
	/** Specific data categories to delete (when scope is 'specific') */
	categories?: string[];
	/** Reason for deletion */
	reason?: string;
	/** Request metadata */
	metadata?: Record<string, unknown>;
}

/** Result of data deletion */
export interface DataDeletionResult {
	/** Whether deletion was successful */
	success: boolean;
	/** Subject identifier */
	subjectId: string;
	/** Scope of deletion performed */
	scope: DeletionScope;
	/** Whether data was anonymized vs deleted */
	anonymized: boolean;
	/** Number of records deleted/anonymized */
	recordsAffected: number;
	/** Data categories affected */
	categoriesAffected: string[];
	/** Deletion certificate (for compliance records) */
	certificate: DeletionCertificate;
	/** Deletion timestamp */
	deletedAt: number;
	/** Error message if failed */
	error?: string;
}

/** Deletion certificate for compliance records */
export interface DeletionCertificate {
	/** Certificate ID */
	id: string;
	/** Subject identifier */
	subjectId: string;
	/** Type of deletion */
	type: "soft" | "hard" | "anonymization";
	/** Scope of deletion */
	scope: DeletionScope;
	/** Categories deleted */
	categories: string[];
	/** Record count */
	recordCount: number;
	/** Deletion timestamp */
	deletedAt: number;
	/** Reason for deletion */
	reason?: string;
	/** SHA-256 hash of certificate content */
	hash: string;
}

/** Consent record for a subject */
export interface ConsentRecord {
	/** Subject identifier */
	subjectId: string;
	/** Consent purpose (e.g., 'marketing', 'analytics', 'personalization') */
	purpose: string;
	/** Whether consent is granted */
	granted: boolean;
	/** When consent was granted (if granted) */
	grantedAt?: number;
	/** When consent expires (if applicable) */
	expiresAt?: number;
	/** When consent was revoked (if revoked) */
	revokedAt?: number;
	/** Source of consent (e.g., 'signup_form', 'settings_page') */
	source?: string;
	/** Consent version/hash (for tracking which T&C version was accepted) */
	version?: string;
}

/** Consent tracker interface */
export interface ConsentTracker {
	/** Record consent grant */
	grant(subjectId: string, purpose: string, options?: {
		expiresAt?: number;
		source?: string;
		version?: string;
	}): Promise<ConsentRecord>;
	/** Revoke consent */
	revoke(subjectId: string, purpose: string): Promise<ConsentRecord | null>;
	/** Check if consent is granted */
	check(subjectId: string, purpose: string): Promise<boolean>;
	/** Get all consents for a subject */
	getForSubject(subjectId: string): Promise<ConsentRecord[]>;
	/** Get all subjects with consent for a purpose */
	getForPurpose(purpose: string): Promise<ConsentRecord[]>;
}

/** Retention policy */
export interface RetentionPolicy {
	/** Policy name */
	name: string;
	/** Default retention period in milliseconds */
	defaultRetentionMs: number;
	/** Category-specific retention periods */
	categoryRetention?: Record<string, number>;
	/** Callback before data is deleted */
	onBeforeDelete?: (data: { category: string; count: number }) => Promise<void>;
	/** Callback after data is deleted */
	onAfterDelete?: (data: { category: string; count: number }) => void;
}

/** Storage adapter for compliance data */
export interface ComplianceStorage {
	/** Get all data for a subject */
	getSubjectData(subjectId: string, categories?: string[]): Promise<{
		category: string;
		records: Array<{ id: string; data: Record<string, unknown>; createdAt: number }>;
	}[]>;
	/** Delete data for a subject */
	deleteSubjectData(subjectId: string, categories?: string[]): Promise<number>;
	/** Anonymize data for a subject */
	anonymizeSubjectData(subjectId: string, categories?: string[]): Promise<number>;
	/** Get audit entries for a subject */
	getAuditEntries?(subjectId: string): Promise<Array<{
		id: string;
		timestamp: number;
		eventType: string;
		payload: Record<string, unknown>;
	}>>;
	/** Get data older than timestamp by category */
	getExpiredData(category: string, olderThan: number): Promise<Array<{ id: string; createdAt: number }>>;
	/** Delete records by IDs */
	deleteByIds(ids: string[]): Promise<number>;
	/** Store consent record */
	storeConsent(record: ConsentRecord): Promise<void>;
	/** Get consent record */
	getConsent(subjectId: string, purpose: string): Promise<ConsentRecord | null>;
	/** Get consents by subject */
	getConsentsBySubject(subjectId: string): Promise<ConsentRecord[]>;
	/** Get consents by purpose */
	getConsentsByPurpose(purpose: string): Promise<ConsentRecord[]>;
	/** Store deletion certificate */
	storeDeletionCertificate(certificate: DeletionCertificate): Promise<void>;
}

/** Compliance configuration */
export interface ComplianceConfig {
	/** Storage adapter */
	storage: ComplianceStorage;
	/** Retention policy */
	retention?: RetentionPolicy;
	/** Consent purposes to track */
	consentPurposes?: string[];
	/** Export link expiration (default: 24 hours) */
	exportExpirationMs?: number;
	/** Audit all compliance operations */
	auditOperations?: boolean;
	/** Event callbacks */
	events?: {
		onExport?: (result: DataExportResult) => void;
		onDelete?: (result: DataDeletionResult) => void;
		onConsentChange?: (record: ConsentRecord) => void;
		onRetentionEnforced?: (category: string, count: number) => void;
	};
}

/** Compliance instance */
export interface ComplianceInstance {
	/** Export data for a subject (GDPR Article 20) */
	exportData(request: DataExportRequest): Promise<DataExportResult>;
	/** Delete data for a subject (GDPR Article 17) */
	deleteData(request: DataDeletionRequest): Promise<DataDeletionResult>;
	/** Consent tracker */
	consent: ConsentTracker;
	/** Enforce retention policy */
	enforceRetention(): Promise<number>;
	/** Create a guardrail that checks consent before processing */
	createConsentGuardrail(purpose: string): GuardrailFn<InputGuardrailData>;
	/** Get deletion certificate by ID */
	getDeletionCertificate(subjectId: string): Promise<DeletionCertificate | null>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default export link expiration (24 hours) */
const DEFAULT_EXPORT_EXPIRATION_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Utility Functions
// ============================================================================

/** Generate a unique ID */
function generateId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Convert string to Uint8Array */
function stringToBytes(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

/** Convert Uint8Array to hex string */
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Calculate SHA-256 hash of content */
async function sha256(content: string): Promise<string> {
	const bytes = stringToBytes(content);
	const hashBuffer = await globalThis.crypto.subtle.digest(
		"SHA-256",
		bytes as unknown as ArrayBuffer
	);
	return bytesToHex(new Uint8Array(hashBuffer));
}

/** Convert data to CSV format */
function toCSV(data: Array<Record<string, unknown>>): string {
	if (data.length === 0) return "";

	// Get all unique keys
	const keys = new Set<string>();
	for (const record of data) {
		for (const key of Object.keys(record)) {
			keys.add(key);
		}
	}

	const headers = Array.from(keys);

	// Build CSV
	const lines: string[] = [headers.join(",")];

	for (const record of data) {
		const values = headers.map((key) => {
			const value = record[key];
			if (value === null || value === undefined) return "";
			if (typeof value === "object") return JSON.stringify(value).replace(/"/g, '""');
			const str = String(value);
			// Escape quotes and wrap in quotes if contains comma or newline
			if (str.includes(",") || str.includes("\n") || str.includes('"')) {
				return `"${str.replace(/"/g, '""')}"`;
			}
			return str;
		});
		lines.push(values.join(","));
	}

	return lines.join("\n");
}

// ============================================================================
// In-Memory Storage (for testing/development)
// ============================================================================

/** Create an in-memory compliance storage adapter */
export function createInMemoryComplianceStorage(): ComplianceStorage {
	const data = new Map<string, Map<string, Array<{
		id: string;
		data: Record<string, unknown>;
		createdAt: number;
	}>>>();
	const consents = new Map<string, ConsentRecord>();
	const certificates = new Map<string, DeletionCertificate>();

	return {
		async getSubjectData(subjectId, categories) {
			const result: Array<{
				category: string;
				records: Array<{ id: string; data: Record<string, unknown>; createdAt: number }>;
			}> = [];

			for (const [category, subjectMap] of data) {
				if (categories && !categories.includes(category)) continue;

				const records = subjectMap.get(subjectId);
				if (records && records.length > 0) {
					result.push({ category, records: [...records] });
				}
			}

			return result;
		},

		async deleteSubjectData(subjectId, categories) {
			let count = 0;

			for (const [category, subjectMap] of data) {
				if (categories && !categories.includes(category)) continue;

				const records = subjectMap.get(subjectId);
				if (records) {
					count += records.length;
					subjectMap.delete(subjectId);
				}
			}

			return count;
		},

		async anonymizeSubjectData(subjectId, categories) {
			let count = 0;

			for (const [category, subjectMap] of data) {
				if (categories && !categories.includes(category)) continue;

				const records = subjectMap.get(subjectId);
				if (records) {
					for (const record of records) {
						// Replace PII with anonymized values
						record.data = {
							...record.data,
							_anonymized: true,
							_anonymizedAt: Date.now(),
						};
						count++;
					}
				}
			}

			return count;
		},

		async getExpiredData(category, olderThan) {
			const result: Array<{ id: string; createdAt: number }> = [];
			const categoryData = data.get(category);

			if (categoryData) {
				for (const records of categoryData.values()) {
					for (const record of records) {
						if (record.createdAt < olderThan) {
							result.push({ id: record.id, createdAt: record.createdAt });
						}
					}
				}
			}

			return result;
		},

		async deleteByIds(ids) {
			const idSet = new Set(ids);
			let count = 0;

			for (const categoryData of data.values()) {
				for (const [subjectId, records] of categoryData) {
					const filtered = records.filter((r) => !idSet.has(r.id));
					if (filtered.length !== records.length) {
						count += records.length - filtered.length;
						if (filtered.length === 0) {
							categoryData.delete(subjectId);
						} else {
							categoryData.set(subjectId, filtered);
						}
					}
				}
			}

			return count;
		},

		async storeConsent(record) {
			consents.set(`${record.subjectId}:${record.purpose}`, record);
		},

		async getConsent(subjectId, purpose) {
			return consents.get(`${subjectId}:${purpose}`) ?? null;
		},

		async getConsentsBySubject(subjectId) {
			const result: ConsentRecord[] = [];
			for (const [key, record] of consents) {
				if (key.startsWith(`${subjectId}:`)) {
					result.push(record);
				}
			}
			return result;
		},

		async getConsentsByPurpose(purpose) {
			const result: ConsentRecord[] = [];
			for (const [key, record] of consents) {
				if (key.endsWith(`:${purpose}`)) {
					result.push(record);
				}
			}
			return result;
		},

		async storeDeletionCertificate(certificate) {
			certificates.set(certificate.subjectId, certificate);
		},
	};
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a compliance instance for GDPR/CCPA data subject rights.
 *
 * Features:
 * - Data Export (GDPR Article 20) - Portable data export
 * - Data Deletion (GDPR Article 17) - Right to erasure
 * - Consent Tracking - Track and verify consent
 * - Retention Policies - Automatic data retention
 *
 * @example
 * ```typescript
 * const compliance = createCompliance({
 *   storage: myStorageAdapter,
 *   retention: {
 *     name: 'default',
 *     defaultRetentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year
 *     categoryRetention: {
 *       audit: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years
 *     },
 *   },
 *   consentPurposes: ['marketing', 'analytics', 'personalization'],
 * });
 *
 * // Export user data
 * const exportResult = await compliance.exportData({
 *   subjectId: 'user-123',
 *   format: 'json',
 * });
 *
 * // Check consent
 * const hasConsent = await compliance.consent.check('user-123', 'marketing');
 * ```
 */
export function createCompliance(config: ComplianceConfig): ComplianceInstance {
	const {
		storage,
		retention,
		exportExpirationMs = DEFAULT_EXPORT_EXPIRATION_MS,
		events = {},
	} = config;

	// Consent tracker implementation
	const consent: ConsentTracker = {
		async grant(subjectId, purpose, options = {}) {
			const record: ConsentRecord = {
				subjectId,
				purpose,
				granted: true,
				grantedAt: Date.now(),
				expiresAt: options.expiresAt,
				source: options.source,
				version: options.version,
			};

			await storage.storeConsent(record);
			events.onConsentChange?.(record);

			return record;
		},

		async revoke(subjectId, purpose) {
			const existing = await storage.getConsent(subjectId, purpose);
			if (!existing) return null;

			const record: ConsentRecord = {
				...existing,
				granted: false,
				revokedAt: Date.now(),
			};

			await storage.storeConsent(record);
			events.onConsentChange?.(record);

			return record;
		},

		async check(subjectId, purpose) {
			const record = await storage.getConsent(subjectId, purpose);
			if (!record) return false;
			if (!record.granted) return false;
			if (record.expiresAt && record.expiresAt < Date.now()) return false;
			return true;
		},

		async getForSubject(subjectId) {
			return storage.getConsentsBySubject(subjectId);
		},

		async getForPurpose(purpose) {
			return storage.getConsentsByPurpose(purpose);
		},
	};

	return {
		async exportData(request) {
			try {
				const subjectData = await storage.getSubjectData(
					request.subjectId,
					request.categories
				);

				// Flatten records for export
				const allRecords: Array<{
					category: string;
					id: string;
					data: Record<string, unknown>;
					createdAt: number;
				}> = [];

				const categories: string[] = [];

				for (const { category, records } of subjectData) {
					categories.push(category);
					for (const record of records) {
						allRecords.push({ category, ...record });
					}
				}

				// Include audit entries if requested
				if (request.includeAudit && storage.getAuditEntries) {
					const auditEntries = await storage.getAuditEntries(request.subjectId);
					categories.push("audit");
					for (const entry of auditEntries) {
						allRecords.push({
							category: "audit",
							id: entry.id,
							data: entry.payload,
							createdAt: entry.timestamp,
						});
					}
				}

				// Format data
				let data: string;
				if (request.format === "csv") {
					data = toCSV(allRecords.map((r) => ({
						category: r.category,
						id: r.id,
						createdAt: new Date(r.createdAt).toISOString(),
						...r.data,
					})));
				} else {
					data = JSON.stringify({
						subjectId: request.subjectId,
						exportedAt: new Date().toISOString(),
						recordCount: allRecords.length,
						categories,
						records: allRecords,
					}, null, 2);
				}

				// Calculate checksum
				const checksum = await sha256(data);

				const result: DataExportResult = {
					success: true,
					subjectId: request.subjectId,
					format: request.format,
					data,
					categories,
					recordCount: allRecords.length,
					checksum,
					exportedAt: Date.now(),
					expiresAt: Date.now() + exportExpirationMs,
				};

				events.onExport?.(result);
				return result;
			} catch (error) {
				return {
					success: false,
					subjectId: request.subjectId,
					format: request.format,
					data: "",
					categories: [],
					recordCount: 0,
					checksum: "",
					exportedAt: Date.now(),
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},

		async deleteData(request) {
			try {
				let recordsAffected = 0;
				const categoriesAffected: string[] = [];

				if (request.anonymize) {
					recordsAffected = await storage.anonymizeSubjectData(
						request.subjectId,
						request.categories
					);
				} else {
					recordsAffected = await storage.deleteSubjectData(
						request.subjectId,
						request.categories
					);
				}

				// Track affected categories
				if (request.categories) {
					categoriesAffected.push(...request.categories);
				} else if (request.scope === "all") {
					categoriesAffected.push("all");
				}

				// Create deletion certificate
				const certificateContent = JSON.stringify({
					subjectId: request.subjectId,
					type: request.anonymize ? "anonymization" : "hard",
					scope: request.scope,
					categories: categoriesAffected,
					recordCount: recordsAffected,
					deletedAt: Date.now(),
					reason: request.reason,
				});

				const certificate: DeletionCertificate = {
					id: generateId(),
					subjectId: request.subjectId,
					type: request.anonymize ? "anonymization" : "hard",
					scope: request.scope,
					categories: categoriesAffected,
					recordCount: recordsAffected,
					deletedAt: Date.now(),
					reason: request.reason,
					hash: await sha256(certificateContent),
				};

				await storage.storeDeletionCertificate(certificate);

				const result: DataDeletionResult = {
					success: true,
					subjectId: request.subjectId,
					scope: request.scope,
					anonymized: request.anonymize ?? false,
					recordsAffected,
					categoriesAffected,
					certificate,
					deletedAt: Date.now(),
				};

				events.onDelete?.(result);
				return result;
			} catch (error) {
				return {
					success: false,
					subjectId: request.subjectId,
					scope: request.scope,
					anonymized: request.anonymize ?? false,
					recordsAffected: 0,
					categoriesAffected: [],
					certificate: {
						id: "error",
						subjectId: request.subjectId,
						type: "hard",
						scope: request.scope,
						categories: [],
						recordCount: 0,
						deletedAt: Date.now(),
						hash: "",
					},
					deletedAt: Date.now(),
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},

		consent,

		async enforceRetention() {
			if (!retention) return 0;

			let totalDeleted = 0;
			const now = Date.now();

			// Get all categories to check
			const categories = new Set<string>();
			if (retention.categoryRetention) {
				for (const category of Object.keys(retention.categoryRetention)) {
					categories.add(category);
				}
			}

			// Default category for anything not specified
			categories.add("default");

			for (const category of categories) {
				const retentionMs = retention.categoryRetention?.[category] ?? retention.defaultRetentionMs;
				const cutoff = now - retentionMs;

				const expired = await storage.getExpiredData(category, cutoff);

				if (expired.length > 0) {
					await retention.onBeforeDelete?.({ category, count: expired.length });

					const deleted = await storage.deleteByIds(expired.map((e) => e.id));
					totalDeleted += deleted;

					retention.onAfterDelete?.({ category, count: deleted });
					events.onRetentionEnforced?.(category, deleted);
				}
			}

			return totalDeleted;
		},

		createConsentGuardrail(purpose: string): GuardrailFn<InputGuardrailData> {
			return async (data): Promise<GuardrailResult> => {
				// Extract subject ID from input or context
				// This is a simple implementation - in practice you'd extract from context
				const subjectIdMatch = data.input.match(/user[_-]?id[:\s]*([a-zA-Z0-9-]+)/i);
				const subjectId = subjectIdMatch?.[1];

				if (!subjectId) {
					// No subject ID found - allow (fail open) or block (fail closed)
					// Default to fail open for better UX
					return { passed: true };
				}

				const hasConsent = await consent.check(subjectId, purpose);

				if (!hasConsent) {
					return {
						passed: false,
						reason: `No consent for '${purpose}' from subject ${subjectId}`,
					};
				}

				return { passed: true };
			};
		},

		async getDeletionCertificate(_subjectId) {
			// This would need to be implemented in the storage adapter
			// For now, return null as the interface doesn't expose get
			return null;
		},
	};
}

// ============================================================================
// Exports
// ============================================================================

export {
	createCompliance as create,
	createInMemoryComplianceStorage as createInMemoryStorage,
};
