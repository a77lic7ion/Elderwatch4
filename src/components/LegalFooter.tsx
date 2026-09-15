import React from 'react';
import { useAppTheme } from './ThemeToggle';

// ============================================================================
// Legal footer — copyright + patent notice, shown on every app page.
// Single source of truth: change the wording here and every screen follows.
// ============================================================================

export const LEGAL_PRODUCT = 'ElderWatch';
export const LEGAL_OWNER = 'Shaun Gordon';
export const LEGAL_YEAR = '2026';

export const LEGAL_LINE_1 = `© ${LEGAL_YEAR} ${LEGAL_OWNER} · ${LEGAL_PRODUCT}. All rights reserved. Patent Pending.`;
export const LEGAL_LINE_2 = `${LEGAL_PRODUCT} and its software, design and content are protected by copyright law. Unauthorised copying, modification or distribution is prohibited.`;

interface LegalFooterProps {
  className?: string;
  /** Compact drops the second sentence - for tight screens. */
  compact?: boolean;
}

export const LegalFooter: React.FC<LegalFooterProps> = ({ className = '', compact = false }) => {
  const [isNight] = useAppTheme();

  return (
    <footer
      className={`text-center px-4 py-6 ${isNight ? 'text-slate-500' : 'text-slate-400'} ${className}`}
    >
      <p className="text-[11.5px] font-semibold leading-relaxed">{LEGAL_LINE_1}</p>
      {!compact && (
        <p className="text-[10.5px] leading-relaxed mt-1 max-w-2xl mx-auto opacity-80">{LEGAL_LINE_2}</p>
      )}
    </footer>
  );
};

export default LegalFooter;
