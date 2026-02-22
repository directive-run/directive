import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { FormWizardDemo } from './FormWizardDemo'

export const metadata = buildPageMetadata({
  title: 'Form Wizard',
  description:
    'Interactive multi-step form wizard demo built with Directive. Constraint-gated step advancement, per-step validation, and persistence.',
  path: '/docs/examples/form-wizard',
  section: 'Docs',
})

export default function FormWizardPage() {
  const build = parseExampleBuild('form-wizard')
  const sources = readExampleSources('form-wizard', [
    'form-wizard.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Form Wizard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Multi-step form with constraint-gated advancement, async validation,
          and persistence for save-and-resume.
        </p>
      </header>

      <FormWizardDemo build={build} sources={sources} />
    </div>
  )
}
