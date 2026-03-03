import Image from "next/image";

import { Button } from "@/components/Button";
import { NotFoundContent } from "@/components/NotFoundContent";
import blurCyanImage from "@/images/blur-cyan.png";
import blurIndigoImage from "@/images/blur-indigo.png";

export default function DocsNotFound() {
  return (
    <div className="fixed inset-x-0 top-[4.75rem] bottom-0 z-40 isolate flex items-center overflow-hidden bg-slate-900 dark:bg-brand-surface">
      <Image
        className="absolute top-0 left-0 -translate-x-1/3 -translate-y-1/4 opacity-40"
        src={blurCyanImage}
        alt=""
        width={530}
        height={530}
        unoptimized
        priority
      />
      <Image
        className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 opacity-40"
        src={blurIndigoImage}
        alt=""
        width={567}
        height={567}
        unoptimized
        priority
      />

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center px-6 text-center">
        <NotFoundContent />

        <div className="mt-8 flex gap-4">
          <Button variant="secondary" href="/blog">
            Read the blog
          </Button>
          <Button href="/docs/quick-start">Browse docs</Button>
        </div>
      </div>
    </div>
  );
}
