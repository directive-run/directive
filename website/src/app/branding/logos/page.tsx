import { LogoShowcase } from "@/components/LogoShowcase";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Logo Concepts",
  description: "Logo design concepts for Directive — compare all candidates side-by-side",
  path: "/branding/logos",
  section: "Brand",
});

export default function LogoConceptsPage() {
  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">Brand</p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Logo Concepts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          12 logomark candidates ranked by AE team scores. Click any concept to view it as a full lockup.
        </p>
      </header>
      <LogoShowcase />
    </div>
  );
}
