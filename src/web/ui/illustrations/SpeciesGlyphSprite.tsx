import React from 'react';

export type KeralaSpeciesGlyphId =
  | 'Mathi'
  | 'Ayala'
  | 'Neymeen'
  | 'Choora'
  | 'Kozhuva'
  | 'Karimeen'
  | 'Chemmeen'
  | 'Kanava'
  | 'Thirutha'
  | 'Aavoli'
  | 'Mandhal'
  | 'Kilimeen'
  | 'GenericFish';

export function resolveSpeciesGlyphId(codeOrName: string): KeralaSpeciesGlyphId {
  const key = codeOrName.toUpperCase();
  if (key.includes('SARD') || key.includes('MATHI')) return 'Mathi';
  if (key.includes('MACK') || key.includes('AYALA')) return 'Ayala';
  if (key.includes('SEER') || key.includes('NEYMEEN')) return 'Neymeen';
  if (key.includes('TUNA') || key.includes('CHOORA')) return 'Choora';
  if (key.includes('ANCH') || key.includes('KOZHUVA')) return 'Kozhuva';
  if (key.includes('PEARL') || key.includes('KARIMEEN')) return 'Karimeen';
  if (key.includes('PRAWN') || key.includes('SHRM') || key.includes('CHEMMEEN')) return 'Chemmeen';
  if (key.includes('SQUID') || key.includes('KANAVA')) return 'Kanava';
  if (key.includes('MULL') || key.includes('THIRUTHA')) return 'Thirutha';
  if (key.includes('POMF') || key.includes('AAVOLI')) return 'Aavoli';
  if (key.includes('SOLE') || key.includes('MANDHAL')) return 'Mandhal';
  if (key.includes('PINK') || key.includes('PERCH') || key.includes('KILIMEEN')) return 'Kilimeen';
  return 'GenericFish';
}

export const SpeciesGlyphSprite: React.FC = () => (
  <svg width="0" height="0" className="hidden" aria-hidden="true" focusable="false">
    <defs>
      {/* 1. Mathi (Indian Oil Sardine) — sleek torpedo body */}
      <symbol id="species-Mathi" viewBox="0 0 24 24">
        <path d="M2 12C6 8.5 13 8.5 18 12C13 15.5 6 15.5 2 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M18 12L22 9V15L18 12Z" fill="var(--decor-aqua)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <circle cx="6.5" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 2. Ayala (Indian Mackerel) — striped dorsal pelagic */}
      <symbol id="species-Ayala" viewBox="0 0 24 24">
        <path d="M2 12C6 7.5 14 7.5 18 12C14 16.5 6 16.5 2 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M10 9.5L9 12M13 9.5L12 12M18 12L22 8.5L20.5 12L22 15.5L18 12Z" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 3. Neymeen (King Seer / Indo-Pacific King Mackerel) */}
      <symbol id="species-Neymeen" viewBox="0 0 24 24">
        <path d="M1.5 12C6 7 14.5 7 18.5 12C14.5 17 6 17 1.5 12Z" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M9 8L12 6L13.5 8.5M18.5 12L22.5 8L21 12L22.5 16L18.5 12Z" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="5.5" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 4. Choora (Yellowfin / Skipjack Tuna) — deep muscular fusiform */}
      <symbol id="species-Choora" viewBox="0 0 24 24">
        <path d="M2 12C5.5 6.5 14 6.5 18 12C14 17.5 5.5 17.5 2 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M10 7.5L13 5L14 8M10 16.5L13 19L14 16M18 12L22 8L20.5 12L22 16L18 12Z" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="6" cy="11" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 5. Kozhuva (Indian Anchovy) — slender silver schooler */}
      <symbol id="species-Kozhuva" viewBox="0 0 24 24">
        <path d="M3 12C7 9.5 14 9.5 18.5 12C14 14.5 7 14.5 3 12Z" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M7 12H16M18.5 12L21.5 9.5V14.5L18.5 12Z" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinecap="round" />
      </symbol>
      {/* 6. Karimeen (Pearl Spot) — diamond oval body with bands */}
      <symbol id="species-Karimeen" viewBox="0 0 24 24">
        <path d="M3 12C7 5.5 14 5.5 18 12C14 18.5 7 18.5 3 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M9.5 7.5V16.5M13 8V16M18 12L21.5 9V15L18 12Z" stroke="var(--decor-ink)" strokeWidth="1.5" />
        <circle cx="6.5" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 7. Chemmeen (Karikkadi / Tiger Prawn) — curved segmented carapace */}
      <symbol id="species-Chemmeen" viewBox="0 0 24 24">
        <path d="M6 15C5 10 9 6.5 15 7.5C18.5 8 20 11 18 14C16.5 16 13.5 16.5 11 15" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M6 15L3 13M6 15L4 17.5M11 7.5V11.5M14.5 8V12" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="10.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 8. Kanava (Indian Squid) — mantle diamond fin + tentacles */}
      <symbol id="species-Kanava" viewBox="0 0 24 24">
        <path d="M4 12L9 7L16 9.5V14.5L9 17L4 12Z" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M16 10.5L21 9M16 12H22M16 13.5L21 15" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="13" cy="11" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 9. Thirutha (Grey Mullet) — broad head estuarine jumper */}
      <symbol id="species-Thirutha" viewBox="0 0 24 24">
        <path d="M2.5 12C5.5 8 13.5 8 18 12C13.5 16 5.5 16 2.5 12Z" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M8.5 9L10.5 6.5L12 9M18 12L21.5 9V15L18 12Z" fill="var(--decor-aqua)" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="6" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 10. Aavoli (Silver Pomfret) — deep rhombic disc body */}
      <symbol id="species-Aavoli" viewBox="0 0 24 24">
        <path d="M3 12L10 4.5L17.5 12L10 19.5L3 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M17.5 12L21.5 8.5L20 12L21.5 15.5L17.5 12Z" fill="var(--decor-aqua)" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="7" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 11. Mandhal (Malabar Sole / Flatfish) — asymmetrical oval */}
      <symbol id="species-Mandhal" viewBox="0 0 24 24">
        <ellipse cx="11" cy="12" rx="8" ry="4.5" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M19 12L22 9.5V14.5L19 12Z" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="1.5" />
        <circle cx="6.5" cy="10.8" r="0.9" fill="var(--decor-ink)" />
        <circle cx="8.2" cy="12.5" r="0.9" fill="var(--decor-ink)" />
      </symbol>
      {/* 12. Kilimeen (Threadfin Bream / Pink Perch) — trailing tail filament */}
      <symbol id="species-Kilimeen" viewBox="0 0 24 24">
        <path d="M2.5 12C6 7.5 13.5 7.5 17.5 12C13.5 16.5 6 16.5 2.5 12Z" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M17.5 12L21.5 8L23 6.5M17.5 12L21.5 15.5L19.5 12" stroke="var(--decor-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6.5" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
      {/* 13. GenericFish fallback */}
      <symbol id="species-GenericFish" viewBox="0 0 24 24">
        <path d="M2 12C6 7.5 13.5 7.5 18 12C13.5 16.5 6 16.5 2 12Z" fill="var(--decor-aqua-soft)" stroke="var(--decor-ink)" strokeWidth="1.75" />
        <path d="M18 12L22 8.5V15.5L18 12Z" fill="var(--decor-aqua)" stroke="var(--decor-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <circle cx="6.5" cy="11.5" r="1" fill="var(--decor-ink)" />
      </symbol>
    </defs>
  </svg>
);

export const SpeciesGlyph: React.FC<{
  code: string;
  size?: number;
  className?: string;
}> = ({ code, size = 18, className = '' }) => {
  const glyphId = resolveSpeciesGlyphId(code);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#species-${glyphId}`} />
    </svg>
  );
};
