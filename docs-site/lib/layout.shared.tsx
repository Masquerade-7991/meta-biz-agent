import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 text-[15px] font-semibold text-(--text-strong)">
          <img src="/helo-mark.svg" alt="" width={20} height={22} />
          {appName}
        </span>
      ),
    },
  };
}
