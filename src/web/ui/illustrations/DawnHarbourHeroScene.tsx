import React from 'react';

export const DawnHarbourHeroScene: React.FC<{ className?: string }> = ({
  className = '',
}) => (
  <svg
    viewBox="0 0 280 96"
    fill="none"
    className={`w-full max-w-[280px] h-auto select-none ${className}`}
    aria-hidden="true"
    focusable="false"
  >
    {/* Sky card frame */}
    <rect
      x="2"
      y="2"
      width="276"
      height="92"
      rx="12"
      fill="var(--decor-aqua-soft)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    {/* Rising Malabar dawn sun */}
    <circle
      cx="224"
      cy="34"
      r="16"
      fill="var(--decor-sun-soft)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    <circle cx="224" cy="34" r="8" fill="var(--decor-sun)" />

    {/* Munambam Quay Stone Deck */}
    <path
      d="M2 66H118L128 76H2V66Z"
      fill="var(--decor-sand)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    {/* Digital Platform Scale & Fish Crate on Quay */}
    <rect
      x="24"
      y="46"
      width="26"
      height="20"
      rx="3"
      fill="var(--bg-surface)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    <rect
      x="28"
      y="50"
      width="18"
      height="7"
      rx="1.5"
      fill="var(--decor-sun-soft)"
      stroke="var(--decor-ink)"
      strokeWidth="1.5"
    />
    {/* Quay Crane Arm */}
    <path
      d="M72 66V24L106 34M88 29V48"
      stroke="var(--decor-ink)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="81"
      y="48"
      width="14"
      height="10"
      rx="2"
      fill="var(--decor-sun)"
      stroke="var(--decor-ink)"
      strokeWidth="1.75"
    />

    {/* Fishing Trawler Silhouette */}
    <path
      d="M142 58H212L202 72H150L142 58Z"
      fill="var(--decor-ink)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <rect
      x="156"
      y="42"
      width="26"
      height="16"
      rx="2"
      fill="var(--bg-surface)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    <path d="M170 42V26L184 34" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />

    {/* Pelagic Sea Band */}
    <path
      d="M2 74C38 69 74 79 110 74C146 69 182 79 218 74C244 70 262 76 278 74V82C278 88.6 272.6 94 266 94H14C7.4 94 2 88.6 2 82V74Z"
      fill="var(--decor-aqua)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    <path
      d="M24 84H68M124 84H178M212 84H252"
      stroke="var(--bg-surface)"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);
