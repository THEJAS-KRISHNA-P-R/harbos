import React from 'react';
import { QrCodeSvg } from './QrCodeSvg.tsx';

export interface DocksidePrintSlipProps {
  readonly slipType: 'LOT_TAG' | 'BUYER_SALE_SLIP' | 'FISHERMAN_SETTLEMENT_SLIP';
  readonly printFormat: '58mm' | '80mm' | 'A4';
  readonly isReprint?: boolean;
  readonly harbourName: string;
  readonly referenceNo: string;
  readonly timestampIso: string;
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly highlight?: boolean;
  }>;
  readonly summaryRows?: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly bold?: boolean;
  }>;
  readonly qrPayload: string;
  readonly statutoryFooter?: string;
  readonly onPrint?: () => void;
}

/**
 * Dockside Thermal & Office Slip Component with @page css rules
 * Supports 58mm (portable belt printer), 80mm (dock scale desk), and A4 formats.
 * Prominently watermarks "REPRINT — AUDITED COPY" if isReprint is true.
 */
export const DocksidePrintSlip: React.FC<DocksidePrintSlipProps> = ({
  slipType,
  printFormat,
  isReprint = false,
  harbourName,
  referenceNo,
  timestampIso,
  items,
  summaryRows = [],
  qrPayload,
  statutoryFooter = 'Governed by Kerala Fish Auctioning Act 2021. Tamper-evident SHA-256 audit log enabled.',
  onPrint,
}) => {
  const getFormatClasses = () => {
    switch (printFormat) {
      case '58mm':
        return 'w-[58mm] max-w-[58mm] text-[10px] p-2 leading-tight';
      case '80mm':
        return 'w-[80mm] max-w-[80mm] text-[12px] p-3 leading-normal';
      case 'A4':
      default:
        return 'w-full max-w-[210mm] text-[14px] p-6 leading-relaxed';
    }
  };

  const getSlipTitle = () => {
    switch (slipType) {
      case 'LOT_TAG':
        return 'DOCK LOT WEIGHMENT TAG';
      case 'BUYER_SALE_SLIP':
        return 'COMMERCIAL SALE MEMORANDUM';
      case 'FISHERMAN_SETTLEMENT_SLIP':
        return 'FISHERMAN PROCEEDS VOUCHER';
    }
  };

  return (
    <div className="font-mono bg-white text-black border border-neutral-300 relative print:border-none print:shadow-none shadow-sm rounded-none">
      {/* Watermark for reprints */}
      {isReprint && (
        <div
          aria-label="Reprint Warning"
          className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-10"
        >
          <span className="text-red-700 font-extrabold text-2xl tracking-widest opacity-25 uppercase transform -rotate-25 border-4 border-dashed border-red-700 px-4 py-2 select-none">
            REPRINT — AUDITED COPY
          </span>
        </div>
      )}

      <div className={`mx-auto ${getFormatClasses()}`}>
        {/* Header */}
        <div className="text-center border-b border-black pb-2 mb-2">
          <div className="font-bold uppercase tracking-wider text-[13px]">{harbourName}</div>
          <div className="font-semibold text-[11px] mt-0.5">{getSlipTitle()}</div>
          <div className="text-[10px] text-neutral-600 mt-0.5">REF: {referenceNo}</div>
          <div className="text-[9px] text-neutral-500">{new Date(timestampIso).toLocaleString('en-IN')}</div>
        </div>

        {/* Content Items */}
        <div className="space-y-1 mb-2 border-b border-neutral-300 pb-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex justify-between items-baseline gap-2">
              <span className="text-neutral-600 shrink-0">{it.label}:</span>
              <span className={`text-right font-medium truncate ${it.highlight ? 'font-bold underline' : ''}`}>
                {it.value}
              </span>
            </div>
          ))}
        </div>

        {/* Financial Summaries if present */}
        {summaryRows.length > 0 && (
          <div className="space-y-1 mb-2 border-b border-black pb-2">
            {summaryRows.map((row, idx) => (
              <div
                key={idx}
                className={`flex justify-between items-baseline gap-2 ${row.bold ? 'font-bold text-[12px]' : ''}`}
              >
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* QR Code Validation */}
        <div className="flex flex-col items-center justify-center my-2 text-center">
          <QrCodeSvg
            value={qrPayload}
            size={printFormat === '58mm' ? 100 : 120}
            title={`Slip QR: ${referenceNo}`}
          />
          <span className="text-[8px] text-neutral-500 mt-1 uppercase tracking-tighter">
            SCAN TO VERIFY AUDIT HASH
          </span>
        </div>

        {/* Statutory Footer */}
        <div className="border-t border-neutral-300 pt-1 text-[8px] text-neutral-500 text-center leading-tight">
          {statutoryFooter}
        </div>

        {/* Print Trigger Button (Hidden when printing) */}
        {onPrint && (
          <div className="mt-3 text-center print:hidden">
            <button
              type="button"
              onClick={onPrint}
              className="bg-[var(--brand)] text-white px-3 py-1 text-xs font-semibold rounded hover:bg-[var(--brand-hover)] transition-colors cursor-pointer"
            >
              Print Receipt ({printFormat})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
