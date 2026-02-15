/**
 * Extract API documentation from TypeScript source files using ts-morph.
 *
 * Walks all public exports from the directive package entry points,
 * extracts JSDoc comments, signatures, and examples, then outputs:
 *   - website/docs/generated/api-reference.json (for embeddings)
 *   - website/docs/generated/api-reference.md  (for human browsing)
 *
 * Usage:
 *   npx tsx scripts/extract-api-docs.ts
 *
 * Or via package.json:
 *   pnpm build:api-docs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	Project,
	type SourceFile,
	type ExportedDeclarations,
	type JSDoc,
	type JSDocTag,
	SyntaxKind,
	type InterfaceDeclaration,
	type TypeAliasDeclaration,
	type FunctionDeclaration,
	type VariableDeclaration,
	type ClassDeclaration,
} from "ts-morph";

// ============================================================================
// Types
// ============================================================================

interface ApiDocParam {
	name: string;
	type: string;
	description: string;
}

interface ApiDocReturns {
	type: string;
	description: string;
}

interface ApiDocEntry {
	name: string;
	kind: "function" | "interface" | "type" | "class" | "const";
	module: string;
	file: string;
	signature?: string;
	description: string;
	params?: ApiDocParam[];
	returns?: ApiDocReturns;
	examples?: string[];
	tags?: Record<string, string>;
	methods?: ApiDocMethod[];
}

interface ApiDocMethod {
	name: string;
	signature: string;
	description: string;
	params?: ApiDocParam[];
	returns?: ApiDocReturns;
}

// ============================================================================
// JSDoc Extraction Helpers
// ============================================================================

function getJSDocText(jsDocs: JSDoc[]): string {
	if (jsDocs.length === 0) return "";
	// Use the last JSDoc block (closest to the declaration)
	const doc = jsDocs[jsDocs.length - 1]!;
	return doc.getDescription().trim();
}

function getJSDocTags(jsDocs: JSDoc[]): JSDocTag[] {
	if (jsDocs.length === 0) return [];
	const doc = jsDocs[jsDocs.length - 1]!;
	return doc.getTags();
}

function extractParams(tags: JSDocTag[]): ApiDocParam[] {
	return tags
		.filter((t) => t.getTagName() === "param")
		.map((t) => {
			const text = t.getCommentText()?.trim() ?? "";
			// Parse "name - description" or just "name"
			const match = text.match(/^(\w+)\s*[-–]\s*([\s\S]*)$/);
			if (match) {
				return {
					name: match[1]!,
					type: "",
					description: match[2]!.trim(),
				};
			}

			return { name: text.split(/\s/)[0] ?? text, type: "", description: "" };
		});
}

function extractReturns(tags: JSDocTag[]): ApiDocReturns | undefined {
	const returnsTag = tags.find(
		(t) => t.getTagName() === "returns" || t.getTagName() === "return",
	);
	if (!returnsTag) return undefined;
	const text = returnsTag.getCommentText()?.trim() ?? "";

	return { type: "", description: text };
}

function extractExamples(tags: JSDocTag[]): string[] {
	return tags
		.filter((t) => t.getTagName() === "example")
		.map((t) => {
			const text = t.getCommentText()?.trim() ?? "";

			return text;
		})
		.filter((e) => e.length > 0);
}

function extractThrows(tags: JSDocTag[]): string | undefined {
	const throwsTag = tags.find(
		(t) => t.getTagName() === "throws" || t.getTagName() === "throw",
	);
	if (!throwsTag) return undefined;

	return throwsTag.getCommentText()?.trim();
}

function extractOtherTags(tags: JSDocTag[]): Record<string, string> {
	const result: Record<string, string> = {};
	const skipTags = new Set([
		"param",
		"returns",
		"return",
		"example",
		"throws",
		"throw",
		"packageDocumentation",
	]);

	for (const tag of tags) {
		const name = tag.getTagName();
		if (skipTags.has(name)) continue;
		result[name] = tag.getCommentText()?.trim() ?? "";
	}

	return result;
}

// ============================================================================
// Declaration Processing
// ============================================================================

function getRelativeFile(sourceFile: SourceFile, basePath: string): string {
	const fullPath = sourceFile.getFilePath();

	return path.relative(basePath, fullPath);
}

function processFunction(
	decl: FunctionDeclaration,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const jsDocs = decl.getJsDocs();
	const description = getJSDocText(jsDocs);
	const tags = getJSDocTags(jsDocs);

	// Get all overloads
	const overloads = decl.getOverloads();
	let signature: string;
	if (overloads.length > 0) {
		signature = overloads.map((o) => o.getText().replace(/;$/, "")).join("\n");
	} else {
		// Get just the signature line (no body)
		const params = decl
			.getParameters()
			.map((p) => p.getText())
			.join(", ");
		const returnType = decl.getReturnType().getText(decl);
		signature = `function ${name}(${params}): ${returnType}`;
	}

	// Truncate overly long signatures
	if (signature.length > 2000) {
		signature = signature.slice(0, 2000) + "...";
	}

	const entry: ApiDocEntry = {
		name,
		kind: "function",
		module: moduleName,
		file: getRelativeFile(decl.getSourceFile(), basePath),
		signature,
		description,
		params: extractParams(tags),
		returns: extractReturns(tags),
		examples: extractExamples(tags),
		tags: extractOtherTags(tags),
	};

	const throwsText = extractThrows(tags);
	if (throwsText) {
		entry.tags = { ...entry.tags, throws: throwsText };
	}

	return entry;
}

function processInterface(
	decl: InterfaceDeclaration,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const jsDocs = decl.getJsDocs();
	const description = getJSDocText(jsDocs);
	const tags = getJSDocTags(jsDocs);

	// Get the full interface text but truncate if too long
	let signature = decl.getText();
	if (signature.length > 3000) {
		signature = signature.slice(0, 3000) + "\n  // ... (truncated)";
	}

	// Extract method documentation
	const methods: ApiDocMethod[] = [];
	for (const member of decl.getMembers()) {
		const memberName =
			member.getKind() === SyntaxKind.MethodSignature ||
			member.getKind() === SyntaxKind.PropertySignature
				? (member as { getName?: () => string }).getName?.() ?? ""
				: "";

		if (!memberName) continue;

		const memberJsDocs = (
			member as { getJsDocs?: () => JSDoc[] }
		).getJsDocs?.();
		if (!memberJsDocs || memberJsDocs.length === 0) continue;

		const memberDesc = getJSDocText(memberJsDocs);
		const memberTags = getJSDocTags(memberJsDocs);
		const memberSig = member.getText();

		methods.push({
			name: memberName,
			signature: memberSig.length > 500 ? memberSig.slice(0, 500) + "..." : memberSig,
			description: memberDesc,
			params: extractParams(memberTags),
			returns: extractReturns(memberTags),
		});
	}

	return {
		name,
		kind: "interface",
		module: moduleName,
		file: getRelativeFile(decl.getSourceFile(), basePath),
		signature,
		description,
		examples: extractExamples(tags),
		tags: extractOtherTags(tags),
		methods: methods.length > 0 ? methods : undefined,
	};
}

function processTypeAlias(
	decl: TypeAliasDeclaration,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const jsDocs = decl.getJsDocs();
	const description = getJSDocText(jsDocs);
	const tags = getJSDocTags(jsDocs);

	let signature = decl.getText();
	if (signature.length > 2000) {
		signature = signature.slice(0, 2000) + "...";
	}

	return {
		name,
		kind: "type",
		module: moduleName,
		file: getRelativeFile(decl.getSourceFile(), basePath),
		signature,
		description,
		examples: extractExamples(tags),
		tags: extractOtherTags(tags),
	};
}

function processVariable(
	decl: VariableDeclaration,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const statement = decl.getVariableStatement();
	if (!statement) return null;

	const jsDocs = statement.getJsDocs();
	const description = getJSDocText(jsDocs);
	const tags = getJSDocTags(jsDocs);

	let signature = statement.getText();
	if (signature.length > 2000) {
		signature = signature.slice(0, 2000) + "...";
	}

	return {
		name,
		kind: "const",
		module: moduleName,
		file: getRelativeFile(decl.getSourceFile(), basePath),
		signature,
		description,
		examples: extractExamples(tags),
		tags: extractOtherTags(tags),
	};
}

function processClass(
	decl: ClassDeclaration,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const jsDocs = decl.getJsDocs();
	const description = getJSDocText(jsDocs);
	const tags = getJSDocTags(jsDocs);

	return {
		name,
		kind: "class",
		module: moduleName,
		file: getRelativeFile(decl.getSourceFile(), basePath),
		signature: `class ${name}`,
		description,
		examples: extractExamples(tags),
		tags: extractOtherTags(tags),
	};
}

function processDeclaration(
	decl: ExportedDeclarations,
	name: string,
	moduleName: string,
	basePath: string,
): ApiDocEntry | null {
	const kind = decl.getKind();

	switch (kind) {
		case SyntaxKind.FunctionDeclaration:
			return processFunction(
				decl as FunctionDeclaration,
				name,
				moduleName,
				basePath,
			);
		case SyntaxKind.InterfaceDeclaration:
			return processInterface(
				decl as InterfaceDeclaration,
				name,
				moduleName,
				basePath,
			);
		case SyntaxKind.TypeAliasDeclaration:
			return processTypeAlias(
				decl as TypeAliasDeclaration,
				name,
				moduleName,
				basePath,
			);
		case SyntaxKind.VariableDeclaration:
			return processVariable(
				decl as VariableDeclaration,
				name,
				moduleName,
				basePath,
			);
		case SyntaxKind.ClassDeclaration:
			return processClass(
				decl as ClassDeclaration,
				name,
				moduleName,
				basePath,
			);
		default:
			return null;
	}
}

// ============================================================================
// Markdown Generation
// ============================================================================

function entryToMarkdown(entry: ApiDocEntry): string {
	const lines: string[] = [];
	const heading = entry.kind === "interface" || entry.kind === "type"
		? `### ${entry.name}`
		: `### ${entry.name}()`;

	lines.push(heading);
	lines.push("");
	lines.push(`*${entry.kind}* — \`${entry.file}\``);
	lines.push("");

	if (entry.description) {
		lines.push(entry.description);
		lines.push("");
	}

	if (entry.signature) {
		lines.push("```typescript");
		lines.push(entry.signature);
		lines.push("```");
		lines.push("");
	}

	if (entry.params && entry.params.length > 0) {
		lines.push("**Parameters:**");
		lines.push("");
		lines.push("| Name | Description |");
		lines.push("|------|-------------|");
		for (const p of entry.params) {
			lines.push(`| \`${p.name}\` | ${p.description} |`);
		}
		lines.push("");
	}

	if (entry.returns) {
		lines.push(`**Returns:** ${entry.returns.description}`);
		lines.push("");
	}

	if (entry.methods && entry.methods.length > 0) {
		lines.push("**Methods:**");
		lines.push("");
		for (const m of entry.methods) {
			lines.push(`#### \`.${m.name}()\``);
			lines.push("");
			if (m.description) {
				lines.push(m.description);
				lines.push("");
			}
			if (m.signature) {
				lines.push("```typescript");
				lines.push(m.signature);
				lines.push("```");
				lines.push("");
			}
		}
	}

	if (entry.examples && entry.examples.length > 0) {
		for (const ex of entry.examples) {
			lines.push("**Example:**");
			lines.push("");
			// If the example already has fences, use it as-is
			if (ex.includes("```")) {
				lines.push(ex);
			} else {
				lines.push("```typescript");
				lines.push(ex);
				lines.push("```");
			}
			lines.push("");
		}
	}

	if (entry.tags?.throws) {
		lines.push(`**Throws:** ${entry.tags.throws}`);
		lines.push("");
	}

	return lines.join("\n");
}

function generateMarkdown(entries: ApiDocEntry[]): string {
	const lines: string[] = [];
	lines.push("# Directive API Reference (Internal)");
	lines.push("");
	lines.push("> Auto-generated from JSDoc — do not edit manually");
	lines.push("");

	// Group by module
	const groups = new Map<string, ApiDocEntry[]>();
	for (const entry of entries) {
		const group = groups.get(entry.module) ?? [];
		group.push(entry);
		groups.set(entry.module, group);
	}

	// Sort groups: "directive" first, then alphabetical
	const sortedModules = [...groups.keys()].sort((a, b) => {
		if (a === "directive") return -1;
		if (b === "directive") return 1;

		return a.localeCompare(b);
	});

	for (const mod of sortedModules) {
		const moduleEntries = groups.get(mod)!;
		lines.push(`## ${mod === "directive" ? "Core (`directive`)" : `AI Adapter (\`${mod}\`)`}`);
		lines.push("");

		// Sort alphabetically within each group
		moduleEntries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of moduleEntries) {
			lines.push(entryToMarkdown(entry));
			lines.push("---");
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	console.log("Extracting API documentation from TypeScript sources...\n");

	const rootDir = path.resolve(__dirname, "..");
	const corePackageDir = path.resolve(rootDir, "../packages/core");
	const aiPackageDir = path.resolve(rootDir, "../packages/ai");
	const basePath = corePackageDir;

	// Create ts-morph project
	const project = new Project({
		tsConfigFilePath: path.join(corePackageDir, "tsconfig.json"),
		skipAddingFilesFromTsConfig: true,
	});

	// Add entry points
	const coreEntry = path.join(corePackageDir, "src/index.ts");
	const aiEntry = path.join(aiPackageDir, "src/index.ts");

	const entryFiles: Array<{ path: string; module: string }> = [
		{ path: coreEntry, module: "@directive-run/core" },
	];

	if (fs.existsSync(aiEntry)) {
		entryFiles.push({ path: aiEntry, module: "@directive-run/ai" });
	}

	const allEntries: ApiDocEntry[] = [];
	const seenNames = new Set<string>();

	for (const entryFile of entryFiles) {
		const sourceFile = project.addSourceFileAtPath(entryFile.path);

		// Resolve dependencies so ts-morph can follow re-exports
		project.resolveSourceFileDependencies();

		const exportedDecls = sourceFile.getExportedDeclarations();

		for (const [name, decls] of exportedDecls) {
			// Skip duplicates across modules (core takes precedence)
			const key = `${entryFile.module}:${name}`;
			if (seenNames.has(key)) continue;
			seenNames.add(key);

			// For overloaded functions, process the implementation
			// For other types, process the first declaration
			for (const decl of decls) {
				const entry = processDeclaration(
					decl,
					name,
					entryFile.module,
					basePath,
				);
				if (entry) {
					// Only include entries with meaningful JSDoc
					if (entry.description || (entry.examples && entry.examples.length > 0)) {
						allEntries.push(entry);
					}
					break; // Take the first successful processing
				}
			}
		}
	}

	console.log(`Extracted ${allEntries.length} documented API entries\n`);

	// Sort entries
	allEntries.sort((a, b) => {
		if (a.module !== b.module) {
			return a.module === "directive" ? -1 : 1;
		}

		return a.name.localeCompare(b.name);
	});

	// Write JSON
	const outDir = path.resolve(rootDir, "docs/generated");
	fs.mkdirSync(outDir, { recursive: true });

	const jsonPath = path.join(outDir, "api-reference.json");
	fs.writeFileSync(jsonPath, JSON.stringify(allEntries, null, 2));
	console.log(`Wrote ${jsonPath}`);

	// Write Markdown
	const mdPath = path.join(outDir, "api-reference.md");
	const markdown = generateMarkdown(allEntries);
	fs.writeFileSync(mdPath, markdown);
	console.log(`Wrote ${mdPath}`);

	// Summary
	const byKind = new Map<string, number>();
	for (const entry of allEntries) {
		byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
	}
	console.log("\nSummary:");
	for (const [kind, count] of [...byKind.entries()].sort()) {
		console.log(`  ${kind}: ${count}`);
	}
	console.log(`  total: ${allEntries.length}`);
}

main().catch((err) => {
	console.error("Failed to extract API docs:", err);
	process.exit(1);
});
