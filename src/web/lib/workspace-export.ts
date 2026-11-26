import type { WorkspaceId } from '@shared/contracts/rbac.ts';
import { formatInrFromPaise, formatKgFromGrams } from '@shared/domain/money.ts';
import type { BootstrapData } from '@web/lib/api.ts';
import { escapeCsvCell } from '@web/lib/utr-reconciliation.ts';
import { humanizeCode } from '@web/lib/ui-formatters.ts';

export type WorkspaceExportFormat = 'csv' | 'pdf';

export interface WorkspaceExportSummaryItem {
  label: string;
  value: string;
}

export interface WorkspaceExportDataset {
  filenameBase: string;
  title: string;
  subtitle: string;
  tenantName: string;
  workspaceId: WorkspaceId;
  workspaceLabel: string;
  generatedAtIso: string;
  summaryItems: ReadonlyArray<WorkspaceExportSummaryItem>;
  headers: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<string>>;
}

function slugifyPart(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'harbour';
}

function formatDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function buildWorkspaceExportDataset(params: {
  workspaceId: WorkspaceId;
  workspaceLabel: string;
  bootstrap: BootstrapData | null;
  now?: Date | undefined;
}): WorkspaceExportDataset {
  const now = params.now ?? new Date();
  const generatedAtIso = now.toISOString();
  const tenantName =
    params.bootstrap?.tenant?.name_en?.trim() || 'Munambam Fishing Harbour (HMS)';
  const tenantSlug = slugifyPart(params.bootstrap?.tenant?.slug || tenantName);
  const filenameBase = `harbouros-${tenantSlug}-${params.workspaceId}-${formatDateStamp(now)}`;

  const data = params.bootstrap;
  if (!data) {
    return {
      filenameBase,
      title: params.workspaceLabel,
      subtitle: `${tenantName} · No records loaded`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [{ label: 'Records', value: '0' }],
      headers: ['Notice'],
      rows: [['Workspace data is still loading.']],
    };
  }

  const vesselById = new Map(data.vessels.map((v) => [v.vessel_id, v]));
  const speciesById = new Map(data.species.map((s) => [s.species_id, s]));
  const lotById = new Map(data.lots.map((l) => [l.lot_id, l]));
  const buyerById = new Map(data.buyers.map((b) => [b.buyer_id, b]));

  if (params.workspaceId === 'weighing') {
    const totalNetGrams = data.lots.reduce(
      (sum, lot) => sum + BigInt(lot.net_grams || '0'),
      0n
    );
    const totalBoxes = data.lots.reduce((sum, lot) => sum + lot.total_boxes, 0);
    return {
      filenameBase,
      title: 'Weighing & Lots Registry',
      subtitle: `${tenantName} · ${data.lots.length} landed lots`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Total Landed Weight', value: formatKgFromGrams(totalNetGrams) },
        { label: 'Tagged Lots', value: String(data.lots.length) },
        { label: 'Total Boxes', value: String(totalBoxes) },
      ],
      headers: [
        'Lot Code',
        'Vessel',
        'Species',
        'Avail / Total Boxes',
        'Net Weight',
        'Core Temp (C)',
        'Grade',
        'Status',
        'Recorded',
      ],
      rows: data.lots.map((lot) => {
        const vessel = vesselById.get(lot.vessel_id);
        const species = speciesById.get(lot.species_id);
        return [
          lot.lot_code,
          vessel ? `${vessel.vessel_name_en} (${vessel.registration_no})` : lot.vessel_id,
          species?.name_en ?? lot.species_id,
          `${lot.available_boxes} / ${lot.total_boxes}`,
          formatKgFromGrams(lot.net_grams),
          String(lot.core_temp_c),
          humanizeCode(lot.inspection_grade),
          humanizeCode(lot.status),
          formatShortTimestamp(lot.created_at),
        ];
      }),
    };
  }

  if (params.workspaceId === 'pit') {
    const totalHammer = data.allocations.reduce(
      (sum, a) => sum + BigInt(a.hammer_paise || '0'),
      0n
    );
    const openLotsCount = data.lots.filter((l) => l.available_boxes > 0).length;
    return {
      filenameBase,
      title: 'Auction Pit Allocations',
      subtitle: `${tenantName} · ${data.allocations.length} pit allocations`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Allocations', value: String(data.allocations.length) },
        { label: 'Open Lots', value: String(openLotsCount) },
        { label: 'Total Hammer Value', value: formatInrFromPaise(totalHammer) },
      ],
      headers: [
        'Allocation',
        'Lot Code',
        'Buyer',
        'Mode',
        'Boxes',
        'Weight',
        'Rate / kg',
        'Hammer Value',
        'Buyer Payable',
        'Recorded',
      ],
      rows: data.allocations.map((alloc) => {
        const lot = lotById.get(alloc.lot_id);
        const buyer = buyerById.get(alloc.buyer_id);
        return [
          alloc.allocation_id,
          lot?.lot_code ?? alloc.lot_id,
          buyer ? `${buyer.buyer_name} (#${buyer.paddle_no})` : alloc.buyer_id,
          humanizeCode(alloc.auction_mode),
          String(alloc.boxes_allocated),
          formatKgFromGrams(alloc.grams_allocated),
          formatInrFromPaise(alloc.price_per_kg_paise),
          formatInrFromPaise(alloc.hammer_paise),
          formatInrFromPaise(alloc.buyer_payable_paise),
          formatShortTimestamp(alloc.created_at),
        ];
      }),
    };
  }

  if (params.workspaceId === 'inspector') {
    const unfitCount = data.lots.filter(
      (l) => l.status === 'BLOCKED_UNFIT' || l.inspection_grade === 'REJECTED_UNFIT'
    ).length;
    const pendingCount = data.lots.filter(
      (l) => l.status === 'WEIGHED_PENDING_INSPECTION'
    ).length;
    return {
      filenameBase,
      title: 'Quality Inspection Register',
      subtitle: `${tenantName} · ${data.lots.length} inspected & queued lots`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Total Lots', value: String(data.lots.length) },
        { label: 'Pending QC', value: String(pendingCount) },
        { label: 'Blocked Unfit', value: String(unfitCount) },
      ],
      headers: [
        'Lot Code',
        'Vessel',
        'Species',
        'Core Temp (C)',
        'Grade',
        'Status',
        'Inspection Notes',
        'Recorded',
      ],
      rows: data.lots.map((lot) => {
        const vessel = vesselById.get(lot.vessel_id);
        const species = speciesById.get(lot.species_id);
        return [
          lot.lot_code,
          vessel?.vessel_name_en ?? lot.vessel_id,
          species?.name_en ?? lot.species_id,
          String(lot.core_temp_c),
          humanizeCode(lot.inspection_grade),
          humanizeCode(lot.status),
          lot.inspection_notes || '—',
          formatShortTimestamp(lot.created_at),
        ];
      }),
    };
  }

  if (params.workspaceId === 'buyer') {
    const totalEscrow = data.buyers.reduce(
      (sum, b) => sum + BigInt(b.escrow_balance_paise || '0'),
      0n
    );
    const totalPayables = data.buyers.reduce(
      (sum, b) => sum + BigInt(b.unsettled_payables_paise || '0'),
      0n
    );
    return {
      filenameBase,
      title: 'Buyer Clearing & Escrow Accounts',
      subtitle: `${tenantName} · ${data.buyers.length} registered wholesale buyers`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Buyers', value: String(data.buyers.length) },
        { label: 'Total Escrow', value: formatInrFromPaise(totalEscrow) },
        { label: 'Unsettled Payables', value: formatInrFromPaise(totalPayables) },
      ],
      headers: [
        'Paddle #',
        'Buyer Name',
        'GSTIN',
        'Export Reg',
        'Escrow Balance',
        'Credit Limit',
        'Unsettled Payables',
        'Active Holds',
      ],
      rows: data.buyers.map((buyer) => [
        `#${buyer.paddle_no}`,
        buyer.buyer_name,
        buyer.gstin,
        buyer.export_reg_no || 'Domestic',
        formatInrFromPaise(buyer.escrow_balance_paise),
        formatInrFromPaise(buyer.approved_credit_paise),
        formatInrFromPaise(buyer.unsettled_payables_paise),
        formatInrFromPaise(buyer.active_holds_paise),
      ]),
    };
  }

  if (params.workspaceId === 'fisher') {
    const totalNet = data.allocations.reduce(
      (sum, a) => sum + BigInt(a.fisherman_net_paise || '0'),
      0n
    );
    const totalBonus = data.allocations.reduce(
      (sum, a) => sum + BigInt(a.bonus_escrow_paise || '0'),
      0n
    );
    return {
      filenameBase,
      title: 'Fisher Passbook & Settlement Statement',
      subtitle: `${tenantName} · ${data.allocations.length} settled lot allocations`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Fisherman Net (95%)', value: formatInrFromPaise(totalNet) },
        { label: 'Bonus Escrow (2%)', value: formatInrFromPaise(totalBonus) },
        { label: 'Settled Allocations', value: String(data.allocations.length) },
      ],
      headers: [
        'Allocation',
        'Lot Code',
        'Boxes',
        'Weight',
        'Hammer Value',
        'Fisherman Net',
        'Bonus Escrow',
        'Recorded',
      ],
      rows: data.allocations.map((alloc) => {
        const lot = lotById.get(alloc.lot_id);
        return [
          alloc.allocation_id,
          lot?.lot_code ?? alloc.lot_id,
          String(alloc.boxes_allocated),
          formatKgFromGrams(alloc.grams_allocated),
          formatInrFromPaise(alloc.hammer_paise),
          formatInrFromPaise(alloc.fisherman_net_paise),
          formatInrFromPaise(alloc.bonus_escrow_paise),
          formatShortTimestamp(alloc.created_at),
        ];
      }),
    };
  }

  if (params.workspaceId === 'harbour') {
    const totalJournalAmount = data.journals.reduce(
      (sum, j) => sum + BigInt(j.total_amount_paise || '0'),
      0n
    );
    return {
      filenameBase,
      title: 'Harbour Ledger Journals',
      subtitle: `${tenantName} · ${data.journals.length} posted ledger journals`,
      tenantName,
      workspaceId: params.workspaceId,
      workspaceLabel: params.workspaceLabel,
      generatedAtIso,
      summaryItems: [
        { label: 'Journals', value: String(data.journals.length) },
        { label: 'Ledger Volume', value: formatInrFromPaise(totalJournalAmount) },
        {
          label: 'Chain Integrity',
          value: data.ledgerVerification.verified ? 'Verified' : 'Attention Required',
        },
      ],
      headers: [
        'Journal ID',
        'Reference Type',
        'Reference ID',
        'Description',
        'Total Amount',
        'Reverses',
        'Recorded',
      ],
      rows: data.journals.map((j) => [
        j.journal_id,
        humanizeCode(j.reference_type),
        j.reference_id,
        j.description,
        formatInrFromPaise(j.total_amount_paise),
        j.reverses_journal_id || '—',
        formatShortTimestamp(j.created_at),
      ]),
    };
  }

  // platform workspace
  const tenants = data.allTenants.length > 0 ? data.allTenants : data.tenant ? [data.tenant] : [];
  return {
    filenameBase,
    title: 'Multi-Tenant Harbours Directory',
    subtitle: `${tenantName} · ${tenants.length} provisioned harbour tenants`,
    tenantName,
    workspaceId: params.workspaceId,
    workspaceLabel: params.workspaceLabel,
    generatedAtIso,
    summaryItems: [
      { label: 'Provisioned Harbours', value: String(tenants.length) },
      { label: 'Active Policies', value: String(data.policies.length) },
      { label: 'Operators', value: String(data.users?.length ?? 0) },
    ],
    headers: [
      'Tenant ID',
      'Slug',
      'Harbour Name',
      'Centre Type',
      'Floor Enforcement',
      'Active Policy',
    ],
    rows: tenants.map((ten) => [
      ten.tenant_id,
      ten.slug,
      ten.name_en,
      humanizeCode(ten.centre_type),
      humanizeCode(ten.floor_enforcement),
      ten.active_policy_id,
    ]),
  };
}

export function serializeDatasetToCsv(dataset: WorkspaceExportDataset): string {
  const lines: string[] = [
    dataset.headers.map((h) => escapeCsvCell(h)).join(','),
    ...dataset.rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function sanitizePdfText(raw: string): string {
  const normalized = raw
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00B7/g, '|')
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  let ascii = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      ascii += normalized[i];
    } else if (code === 176) {
      ascii += ' deg';
    }
  }
  return ascii;
}

function escapePdfLiteral(text: string): string {
  return sanitizePdfText(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateForColumn(text: string, maxChars: number): string {
  const clean = sanitizePdfText(text);
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 3) return clean.slice(0, Math.max(1, maxChars));
  return `${clean.slice(0, maxChars - 3)}...`;
}

/**
 * Generates a standalone, multi-page PDF 1.4 binary (Landscape A4, 842 x 595 pt)
 * using built-in Type-1 Helvetica / Helvetica-Bold fonts with zero external dependencies.
 */
export function serializeDatasetToPdfBytes(dataset: WorkspaceExportDataset): Uint8Array {
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;
  const headerBannerHeight = 56;
  const rowHeight = 19;
  const tableHeaderHeight = 22;

  const colCount = Math.max(1, dataset.headers.length);
  const colWidth = contentWidth / colCount;
  const maxCharsPerCell = Math.max(8, Math.floor((colWidth - 8) / 4.8));

  const rowsPerFirstPage = 19;
  const rowsPerNextPage = 23;
  const pagesData: Array<ReadonlyArray<ReadonlyArray<string>>> = [];

  if (dataset.rows.length === 0) {
    pagesData.push([]);
  } else {
    let cursor = 0;
    pagesData.push(dataset.rows.slice(0, rowsPerFirstPage));
    cursor = rowsPerFirstPage;
    while (cursor < dataset.rows.length) {
      pagesData.push(dataset.rows.slice(cursor, cursor + rowsPerNextPage));
      cursor += rowsPerNextPage;
    }
  }

  const totalPages = pagesData.length;
  const objects: string[] = [];
  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  // Reserve IDs 1 (Catalog), 2 (Pages), 3 (Helvetica), 4 (Helvetica-Bold)
  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontRegularId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const fontBoldId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  const pageIds: number[] = [];

  for (let pIdx = 0; pIdx < totalPages; pIdx += 1) {
    const pageRows = pagesData[pIdx] ?? [];
    const isFirstPage = pIdx === 0;
    const cmds: string[] = [];

    // Navy top header banner matching HarbourOS maritime brand
    cmds.push('0.122 0.220 0.400 rg');
    cmds.push(`0 ${pageHeight - headerBannerHeight} ${pageWidth} ${headerBannerHeight} re f`);

    // Banner title & tenant
    cmds.push('1 1 1 rg');
    cmds.push(`BT /F2 14 Tf ${marginX} ${pageHeight - 25} Td (${escapePdfLiteral(dataset.title)}) Tj ET`);
    cmds.push('0.86 0.90 0.96 rg');
    cmds.push(
      `BT /F1 9 Tf ${marginX} ${pageHeight - 41} Td (${escapePdfLiteral(
        `HarbourOS | ${dataset.tenantName} | Exported ${formatShortTimestamp(dataset.generatedAtIso)}`
      )}) Tj ET`
    );

    let y = pageHeight - headerBannerHeight - 18;

    // Summary metrics strip on page 1
    if (isFirstPage && dataset.summaryItems.length > 0) {
      const boxGap = 10;
      const boxCount = dataset.summaryItems.length;
      const boxWidth = (contentWidth - boxGap * (boxCount - 1)) / boxCount;
      const boxHeight = 36;
      const boxBottom = y - boxHeight;

      for (let sIdx = 0; sIdx < boxCount; sIdx += 1) {
        const item = dataset.summaryItems[sIdx]!;
        const x = marginX + sIdx * (boxWidth + boxGap);
        cmds.push('0.965 0.965 0.953 rg');
        cmds.push(`${x.toFixed(1)} ${boxBottom.toFixed(1)} ${boxWidth.toFixed(1)} ${boxHeight} re f`);
        cmds.push('0.84 0.86 0.90 RG 0.6 w');
        cmds.push(`${x.toFixed(1)} ${boxBottom.toFixed(1)} ${boxWidth.toFixed(1)} ${boxHeight} re S`);
        cmds.push('0.35 0.41 0.51 rg');
        cmds.push(
          `BT /F1 7.5 Tf ${(x + 8).toFixed(1)} ${(boxBottom + 23).toFixed(1)} Td (${escapePdfLiteral(
            item.label.toUpperCase()
          )}) Tj ET`
        );
        cmds.push('0.059 0.122 0.239 rg');
        cmds.push(
          `BT /F2 11 Tf ${(x + 8).toFixed(1)} ${(boxBottom + 9).toFixed(1)} Td (${escapePdfLiteral(
            item.value
          )}) Tj ET`
        );
      }
      y = boxBottom - 16;
    }

    // Table header bar
    const headerBottom = y - tableHeaderHeight;
    cmds.push('0.902 0.922 0.957 rg');
    cmds.push(`${marginX} ${headerBottom.toFixed(1)} ${contentWidth} ${tableHeaderHeight} re f`);
    cmds.push('0.086 0.165 0.310 rg');
    for (let cIdx = 0; cIdx < dataset.headers.length; cIdx += 1) {
      const x = marginX + cIdx * colWidth + 5;
      const label = truncateForColumn(dataset.headers[cIdx] ?? '', maxCharsPerCell);
      cmds.push(
        `BT /F2 8 Tf ${x.toFixed(1)} ${(headerBottom + 7.5).toFixed(1)} Td (${escapePdfLiteral(
          label
        )}) Tj ET`
      );
    }

    y = headerBottom;

    // Table rows
    if (pageRows.length === 0) {
      y -= rowHeight;
      cmds.push('0.35 0.41 0.51 rg');
      cmds.push(
        `BT /F1 9 Tf ${marginX + 6} ${(y + 6).toFixed(1)} Td (No records available in this workspace view.) Tj ET`
      );
    } else {
      for (let rIdx = 0; rIdx < pageRows.length; rIdx += 1) {
        const row = pageRows[rIdx]!;
        const rowBottom = y - rowHeight;
        if (rIdx % 2 === 1) {
          cmds.push('0.980 0.982 0.988 rg');
          cmds.push(`${marginX} ${rowBottom.toFixed(1)} ${contentWidth} ${rowHeight} re f`);
        }
        cmds.push('0.88 0.90 0.93 RG 0.4 w');
        cmds.push(`${marginX} ${rowBottom.toFixed(1)} m ${marginX + contentWidth} ${rowBottom.toFixed(1)} l S`);

        cmds.push('0.059 0.122 0.239 rg');
        for (let cIdx = 0; cIdx < dataset.headers.length; cIdx += 1) {
          const x = marginX + cIdx * colWidth + 5;
          const cellVal = truncateForColumn(row[cIdx] ?? '', maxCharsPerCell);
          cmds.push(
            `BT /F1 7.8 Tf ${x.toFixed(1)} ${(rowBottom + 6).toFixed(1)} Td (${escapePdfLiteral(
              cellVal
            )}) Tj ET`
          );
        }
        y = rowBottom;
      }
    }

    // Footer with page number
    cmds.push('0.85 0.87 0.90 RG 0.5 w');
    cmds.push(`${marginX} 30 m ${marginX + contentWidth} 30 l S`);
    cmds.push('0.35 0.41 0.51 rg');
    cmds.push(
      `BT /F1 7.5 Tf ${marginX} 18 Td (${escapePdfLiteral(
        `HarbourOS Statutory Export | ${dataset.workspaceLabel} | ${dataset.rows.length} rows`
      )}) Tj ET`
    );
    cmds.push(
      `BT /F1 7.5 Tf ${pageWidth - marginX - 60} 18 Td (Page ${pIdx + 1} of ${totalPages}) Tj ET`
    );

    const streamContent = cmds.join('\n');
    const contentStreamId = addObject(
      `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentStreamId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Assemble PDF bytes with exact xref byte offsets
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let byteLength = 0;

  const pushStr = (s: string): void => {
    const bytes = encoder.encode(s);
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  pushStr('%PDF-1.4\n');
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(byteLength);
    pushStr(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }

  const xrefStart = byteLength;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (const offset of offsets) {
    pushStr(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  const out = new Uint8Array(byteLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

export function triggerBrowserFileDownload(params: {
  filename: string;
  mimeType: string;
  data: string | Uint8Array;
}): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  const blobPart: BlobPart =
    typeof params.data === 'string'
      ? params.data
      : new Uint8Array(params.data);
  const blob = new Blob([blobPart], { type: params.mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = params.filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
  return true;
}
