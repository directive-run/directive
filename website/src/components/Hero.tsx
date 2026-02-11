'use client'

import { Fragment, useState } from 'react'
import Image from 'next/image'
import clsx from 'clsx'
import { Highlight } from 'prism-react-renderer'

import { Button } from '@/components/Button'
import { HeroBackground } from '@/components/HeroBackground'
import blurCyanImage from '@/images/blur-cyan.png'
import blurIndigoImage from '@/images/blur-indigo.png'

const moduleCode = `import { createModule } from 'directive';

export default createModule("publish", {
  constraints: {
    validate: {
      when: (f) => f.action === "publish" && !f.validated,
      require: { type: "VALIDATE" },
    },
    upload: {
      when: (f) => f.validated && f.images.length && !f.uploaded,
      require: { type: "UPLOAD" },
    },
    save: {
      when: (f) => f.validated && f.uploaded && !f.saved,
      require: { type: "SAVE" },
    },
  },

  resolvers: {
    validate: { requirement: "VALIDATE", resolve: validateDraft },
    upload:   { requirement: "UPLOAD",   resolve: uploadImages },
    save:     { requirement: "SAVE",     resolve: createPost },
  },
});`

const reactCode = `import { useFact } from 'directive/react';

function PublishButton() {
  const saved = useFact(system, "saved");

  return (
    <button onClick={() => system.facts.action = "publish"}>
      {saved ? "Published \\u2713" : "Publish"}
    </button>
  );
}

// One assignment. Directive validates, uploads, and saves.`

const tabs = [
  { name: 'publish.module.ts', language: 'typescript' },
  { name: 'Editor.tsx', language: 'tsx' },
]

const codeBlocks = [moduleCode, reactCode]

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  )
}

export function Hero() {
  const [activeTab, setActiveTab] = useState(0)
  const activeCode = codeBlocks[activeTab]
  const activeLanguage = tabs[activeTab].language

  return (
    <div className="overflow-hidden bg-slate-900 dark:bg-brand-surface dark:-mt-19 dark:-mb-32 dark:pt-19 dark:pb-32">
      <div className="py-16 sm:px-2 lg:relative lg:px-0 lg:py-20">
        <div className="mx-auto grid max-w-2xl grid-cols-1 items-center gap-x-8 gap-y-16 px-4 lg:max-w-8xl lg:grid-cols-[5fr_7fr] lg:px-8 xl:gap-x-16 xl:px-12">
          <div className="relative z-10 md:text-center lg:text-left">
            <Image
              className="absolute right-full bottom-full -mr-72 -mb-56 opacity-50"
              src={blurCyanImage}
              alt=""
              width={530}
              height={530}
              unoptimized
              priority
            />
            <div className="relative">
              <p className="inline bg-clip-text font-display text-5xl tracking-tight text-transparent" style={{ backgroundImage: 'linear-gradient(to right, var(--brand-gradient-from), var(--brand-gradient-via), var(--brand-gradient-to))' }}>
                State that resolves itself.
              </p>
              <p className="mt-3 text-2xl tracking-tight text-slate-400">
                Declare what must be true. Define how to make it true. Let
                Directive handle when and how to orchestrate it all.
              </p>
              <div className="mt-8 flex gap-4 md:justify-center lg:justify-start">
                <Button href="/docs/quick-start">Get started</Button>
                <Button
                  href="https://github.com/sizls/directive"
                  variant="secondary"
                >
                  View on GitHub
                </Button>
              </div>
            </div>
          </div>
          <div className="relative lg:static">
            <div className="absolute inset-x-[-50vw] -top-32 -bottom-48 mask-[linear-gradient(transparent,white,white)] lg:-top-32 lg:right-0 lg:-bottom-32 lg:left-[calc(50%+14rem)] lg:mask-none dark:mask-[linear-gradient(transparent,white,transparent)] lg:dark:mask-[linear-gradient(white,white,transparent)]">
              <HeroBackground className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-0 lg:translate-x-0 lg:translate-y-[-60%]" />
            </div>
            <div className="relative">
              <Image
                className="absolute -top-64 -right-64"
                src={blurCyanImage}
                alt=""
                width={530}
                height={530}
                unoptimized
                priority
              />
              <Image
                className="absolute -right-44 -bottom-40"
                src={blurIndigoImage}
                alt=""
                width={567}
                height={567}
                unoptimized
                priority
              />
              <div className="absolute inset-0 rounded-2xl bg-linear-to-tr from-brand-primary-300 via-brand-primary-300/70 to-brand-primary-200 opacity-10 blur-lg" />
              <div className="absolute inset-0 rounded-2xl bg-linear-to-tr from-brand-primary-300 via-brand-primary-300/70 to-brand-primary-200 opacity-10" />
              <div className="relative rounded-2xl bg-[#0A101F]/80 ring-1 ring-white/10 backdrop-blur-sm">
                <div className="absolute -top-px right-11 left-20 h-px bg-linear-to-r from-brand-primary-300/0 via-brand-primary-300/70 to-brand-primary-300/0" />
                <div className="absolute right-20 -bottom-px left-11 h-px bg-linear-to-r from-brand-accent-400/0 via-brand-accent-400 to-brand-accent-400/0" />
                <div className="pt-4 pl-4">
                  <TrafficLightsIcon className="h-2.5 w-auto stroke-slate-500/30" />
                  <div className="mt-4 flex space-x-2 text-xs">
                    {tabs.map((tab, index) => (
                      <div
                        key={tab.name}
                        className={clsx(
                          'flex h-6 cursor-pointer rounded-full',
                          index === activeTab
                            ? 'bg-linear-to-r from-brand-primary-400/30 via-brand-primary-400 to-brand-primary-400/30 p-px font-medium text-brand-primary-300'
                            : 'text-slate-500 hover:text-slate-400',
                        )}
                        onClick={() => setActiveTab(index)}
                      >
                        <div
                          className={clsx(
                            'flex items-center rounded-full px-2.5',
                            index === activeTab && 'bg-slate-800',
                          )}
                        >
                          {tab.name}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-start px-1 text-sm">
                    <div
                      aria-hidden="true"
                      className="border-r border-slate-300/5 pr-4 font-mono text-slate-600 select-none"
                    >
                      {Array.from({
                        length: activeCode.split('\n').length,
                      }).map((_, index) => (
                        <Fragment key={index}>
                          {(index + 1).toString().padStart(2, '0')}
                          <br />
                        </Fragment>
                      ))}
                    </div>
                    <Highlight
                      code={activeCode}
                      language={activeLanguage}
                      theme={{ plain: {}, styles: [] }}
                    >
                      {({
                        className,
                        style,
                        tokens,
                        getLineProps,
                        getTokenProps,
                      }) => (
                        <pre
                          className={clsx(
                            className,
                            'flex overflow-x-auto pb-6',
                          )}
                          style={style}
                        >
                          <code className="px-4">
                            {tokens.map((line, lineIndex) => (
                              <div key={lineIndex} {...getLineProps({ line })}>
                                {line.map((token, tokenIndex) => (
                                  <span
                                    key={tokenIndex}
                                    {...getTokenProps({ token })}
                                  />
                                ))}
                              </div>
                            ))}
                          </code>
                        </pre>
                      )}
                    </Highlight>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
